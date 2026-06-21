// 聊天状态管理 —— Zustand
// 会话/消息状态 + 多服务商 + 发送消息 + 流式 + 自动命名 + 持久化

import { create } from 'zustand';
import type { AppSettings, Attachment, Message, ModelSettings, Provider, Session } from './types';
import type { ThemeMode } from './theme';
import * as db from './db';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  getProviderKey,
  setProviderKey,
  deleteProviderKey,
  getOcrKey,
  setOcrKey,
  getTavilyKey,
  setTavilyKey as setTavilyKeySecret,
  deleteTavilyKey as deleteTavilyKeySecret,
  getLlamaParseKey,
  setLlamaParseKey as setLlamaParseKeySecret,
  deleteLlamaParseKey as deleteLlamaParseKeySecret,
} from './settings';
import { makeProvider } from './providers/factory';
import { buildChatMessages, type ToolDef, type ToolExecutor } from './providers/base';
import { getEnabledTools, makeToolExecutor } from './tools';
import { parseFile, type PickedFile } from './parse';

// 待发送的附件（含解析出的文本，发送时拼进 content）
export interface PendingAttachment extends Attachment {
  text: string; // 解析出的正文
}

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// 构造联网搜索工具配置（开关打开且有 Tavily key 时才启用）
async function buildTools(
  get: () => ChatState
): Promise<{ tools?: ToolDef[]; executeTool?: ToolExecutor }> {
  if (!get().webSearchEnabled) return {};
  const tavilyKey = await getTavilyKey();
  if (!tavilyKey) return {};
  return { tools: getEnabledTools(), executeTool: makeToolExecutor(tavilyKey) };
}

// 共享流式逻辑：在 sessionId 下，基于给定历史新建 assistant 占位并流式生成
// historyForModel 是已构造好（含文档正文）的发给模型的消息序列
async function streamReply(
  get: () => ChatState,
  set: (partial: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>)) => void,
  sessionId: string,
  onTitle?: { userText: string }
): Promise<void> {
  const { settings } = get();
  const provider = curProvider(settings);
  if (!provider) throw new Error('请先在设置里添加一个服务商');
  const apiKey = await getProviderKey(provider.id);
  if (!apiKey) throw new Error(`请先为「${provider.name}」填写 API Key`);
  if (!settings.currentModel) throw new Error('请先选择一个模型');

  const session = get().sessions.find((x) => x.id === sessionId);
  const effective: ModelSettings = {
    model: settings.currentModel,
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
    systemPrompt: settings.systemPrompt,
    ...(session?.settingsOverride ?? {}),
  };

  const assistantMsg: Message = {
    id: genId(),
    sessionId,
    role: 'assistant',
    content: '',
    createdAt: Date.now(),
    status: 'streaming',
  };
  await db.insertMessage(assistantMsg);
  set((s) => ({
    messages: [...s.messages, assistantMsg],
    isStreaming: true,
  }));

  // 历史 = 当前 messages 里除占位 assistant 外、有内容的消息
  // 注意：重新生成/编辑重发场景下，docText 已不可得，直接用落库 content
  const history = get().messages.filter(
    (m) => m.id !== assistantMsg.id && m.content
  );
  const chatMessages = buildChatMessages(history, effective);

  const inst = makeProvider(provider);
  const controller = new AbortController();
  set({ abortController: controller });

  // 联网搜索工具（开关打开且有 Tavily key 时启用）
  const { tools, executeTool } = await buildTools(get);

  // 用闭包捕获本次 controller，回调里校验归属，防止被新流式覆盖（竞态保护）
  const myController = controller;
  const isMine = () => get().abortController === myController;

  let acc = '';
  let aborted = false;
  await inst.streamChat(
    { messages: chatMessages, settings: effective, apiKey, signal: controller.signal, tools, executeTool },
    {
      onToolCall: (name) => {
        if (name === 'web_search' && isMine()) set({ searching: true });
      },
      onDelta: (delta) => {
        if (!isMine()) return; // 已被新流式接管，丢弃
        acc += delta;
        set((s) => ({
          searching: false,
          messages: s.messages.map((m) =>
            m.id === assistantMsg.id ? { ...m, content: acc } : m
          ),
        }));
      },
      onDone: async () => {
        // abort 场景 provider 也走 onDone，这里标记
        if (myController.signal.aborted) aborted = true;
        if (!isMine()) return; // 已被新流式接管，不写状态
        try {
          await db.updateMessage(assistantMsg.id, { content: acc, status: 'done' });
        } catch {
          // db 写入失败不阻塞状态复位
        }
        set((s) => ({
          isStreaming: false,
          searching: false,
          abortController: null,
          messages: s.messages.map((m) =>
            m.id === assistantMsg.id ? { ...m, status: 'done' } : m
          ),
        }));
        // abort 时不触发自动命名（acc 可能残缺）
        if (onTitle && !aborted) get().maybeAutoTitle(sessionId, onTitle.userText, acc);
      },
      onError: async (err) => {
        if (!isMine()) return; // 已被新流式接管，不写状态
        try {
          await db.updateMessage(assistantMsg.id, {
            content: acc,
            status: 'error',
            error: err.message,
          });
        } catch {
          // db 写入失败不阻塞状态复位
        }
        set((s) => ({
          isStreaming: false,
          searching: false,
          abortController: null,
          messages: s.messages.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, status: 'error', error: err.message }
              : m
          ),
        }));
      },
    }
  );
}

interface ChatState {
  initialized: boolean;
  settings: AppSettings;
  keyReady: boolean; // 当前服务商是否已配置 key

  sessions: Session[];
  currentSessionId: string | null;
  messages: Message[];
  isStreaming: boolean;
  searching: boolean; // 联网搜索中
  abortController: AbortController | null;

  // 联网搜索
  webSearchEnabled: boolean; // 联网开关（运行时状态，不持久化）
  tavilyReady: boolean; // 是否已配置 Tavily key

  // LlamaParse 文档解析
  llamaparseReady: boolean; // 是否已配置 LlamaParse key

  // 主题
  themeMode: ThemeMode;
  setTheme: (mode: ThemeMode) => Promise<void>;

  init: () => Promise<void>;

  // 设置 / 服务商
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  addProvider: (p: Omit<Provider, 'id'>) => Promise<string>;
  updateProvider: (id: string, patch: Partial<Provider>) => Promise<void>;
  removeProvider: (id: string) => Promise<void>;
  saveProviderKey: (id: string, key: string) => Promise<void>;
  selectModel: (providerId: string, model: string) => Promise<void>;

  // 会话
  newSession: () => Promise<string>;
  selectSession: (id: string) => Promise<void>;
  removeSession: (id: string) => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;

  // 消息
  sendMessage: (text: string, attachments?: PendingAttachment[]) => Promise<void>;
  stopStreaming: () => void;
  maybeAutoTitle: (sessionId: string, userText: string, replyText: string) => Promise<void>;
  deleteMessage: (id: string) => Promise<void>;
  regenerate: (assistantId: string) => Promise<void>;
  editAndResend: (userId: string, newText: string) => Promise<void>;

  // 文档解析
  updateOcr: (patch: Partial<AppSettings['ocr']>) => Promise<void>;
  saveOcrKey: (key: string) => Promise<void>;
  parseAttachment: (file: PickedFile) => Promise<PendingAttachment>;

  // 联网搜索
  toggleWebSearch: () => void;
  saveTavilyKey: (key: string) => Promise<void>;
  deleteTavilyKey: () => Promise<void>;

  // LlamaParse 文档解析
  saveLlamaParseKey: (key: string) => Promise<void>;
  deleteLlamaParseKey: () => Promise<void>;
}

// 取当前服务商
function curProvider(s: AppSettings): Provider | undefined {
  return s.providers.find((p) => p.id === s.currentProviderId);
}

export const useChatStore = create<ChatState>((set, get) => ({
  initialized: false,
  settings: DEFAULT_SETTINGS,
  keyReady: false,
  sessions: [],
  currentSessionId: null,
  messages: [],
  isStreaming: false,
  searching: false,
  abortController: null,
  webSearchEnabled: false,
  tavilyReady: false,
  llamaparseReady: false,
  themeMode: 'system',

  async init() {
    const [settings, sessions] = await Promise.all([
      loadSettings(),
      db.listSessions(),
    ]);
    const prov = curProvider(settings);
    const key = prov ? await getProviderKey(prov.id) : null;
    const tavilyKey = await getTavilyKey();
    const llamaParseKey = await getLlamaParseKey();
    set({
      settings,
      themeMode: settings.theme,
      sessions,
      keyReady: !!key,
      tavilyReady: !!tavilyKey,
      llamaparseReady: !!llamaParseKey,
      initialized: true,
    });
    if (sessions.length > 0) {
      await get().selectSession(sessions[0].id);
    }
  },
  async updateSettings(patch) {
    const next = { ...get().settings, ...patch };
    await saveSettings(next);
    set({ settings: next });
  },

  async setTheme(mode) {
    const next = { ...get().settings, theme: mode };
    await saveSettings(next);
    set({ settings: next, themeMode: mode });
  },

  async addProvider(p) {
    const provider: Provider = { ...p, id: genId() };
    const next = {
      ...get().settings,
      providers: [...get().settings.providers, provider],
    };
    await saveSettings(next);
    set({ settings: next });
    return provider.id;
  },

  async updateProvider(id, patch) {
    const providers = get().settings.providers.map((p) =>
      p.id === id ? { ...p, ...patch } : p
    );
    const next = { ...get().settings, providers };
    await saveSettings(next);
    // 改了当前服务商的模型列表，需保证 currentModel 仍有效
    set({ settings: next });
  },

  async removeProvider(id) {
    const providers = get().settings.providers.filter((p) => p.id !== id);
    if (!providers.length) return; // 至少留一个
    let { currentProviderId, currentModel } = get().settings;
    if (currentProviderId === id) {
      currentProviderId = providers[0].id;
      currentModel = providers[0].models[0] ?? '';
    }
    const next = { ...get().settings, providers, currentProviderId, currentModel };
    await deleteProviderKey(id);
    await saveSettings(next);
    const key = await getProviderKey(currentProviderId);
    set({ settings: next, keyReady: !!key });
  },

  async saveProviderKey(id, key) {
    await setProviderKey(id, key);
    if (id === get().settings.currentProviderId) {
      set({ keyReady: !!key.trim() });
    }
  },

  async selectModel(providerId, model) {
    const next = {
      ...get().settings,
      currentProviderId: providerId,
      currentModel: model,
    };
    await saveSettings(next);
    const key = await getProviderKey(providerId);
    set({ settings: next, keyReady: !!key });
  },

  async newSession() {
    const now = Date.now();
    const session: Session = {
      id: genId(),
      title: '新对话',
      createdAt: now,
      updatedAt: now,
    };
    await db.insertSession(session);
    set((s) => ({
      sessions: [session, ...s.sessions],
      currentSessionId: session.id,
      messages: [],
    }));
    return session.id;
  },

  async selectSession(id) {
    const messages = await db.listMessages(id);
    set({ currentSessionId: id, messages });
  },

  async removeSession(id) {
    await db.deleteSession(id);
    const sessions = get().sessions.filter((s) => s.id !== id);
    set({ sessions });
    if (get().currentSessionId === id) {
      if (sessions.length > 0) await get().selectSession(sessions[0].id);
      else set({ currentSessionId: null, messages: [] });
    }
  },

  async renameSession(id, title) {
    const t = title.trim();
    if (!t) return;
    const now = Date.now();
    await db.updateSession(id, { title: t, updatedAt: now });
    set((s) => ({
      sessions: s.sessions.map((x) =>
        x.id === id ? { ...x, title: t, updatedAt: now } : x
      ),
    }));
  },

  async sendMessage(text, attachments) {
    const content = text.trim();
    const atts = (attachments ?? []).filter((a) => a.status === 'done');
    // 允许「只有附件、没文字」的发送
    if ((!content && !atts.length) || get().isStreaming) return;

    const { settings } = get();
    const provider = curProvider(settings);
    if (!provider) throw new Error('请先在设置里添加一个服务商');
    const apiKey = await getProviderKey(provider.id);
    if (!apiKey) throw new Error(`请先为「${provider.name}」填写 API Key`);
    if (!settings.currentModel) throw new Error('请先选择一个模型');

    let sessionId = get().currentSessionId;
    if (!sessionId) sessionId = await get().newSession();

    // 发给模型的内容 = 各文档正文 + 用户输入
    let modelContent = content;
    if (atts.length) {
      const docs = atts
        .map((a) => `[文档：${a.name}]\n${a.text}`)
        .join('\n\n');
      modelContent = content
        ? `${docs}\n\n---\n${content}`
        : `${docs}\n\n---\n请阅读以上文档。`;
    }


    const now = Date.now();
    const userMsg: Message = {
      id: genId(),
      sessionId,
      role: 'user',
      content: content || '(已发送文档)',
      createdAt: now,
      status: 'done',
      // 只存元信息（不含正文，正文已拼进 modelContent）
      attachments: atts.length
        ? atts.map(({ text: _t, ...meta }) => meta)
        : undefined,
    };
    const assistantMsg: Message = {
      id: genId(),
      sessionId,
      role: 'assistant',
      content: '',
      createdAt: now + 1,
      status: 'streaming',
    };

    await db.insertMessage(userMsg);
    await db.insertMessage(assistantMsg);
    set((s) => ({
      messages: [...s.messages, userMsg, assistantMsg],
      isStreaming: true,
    }));

    const session = get().sessions.find((x) => x.id === sessionId);
    const effective: ModelSettings = {
      model: settings.currentModel,
      temperature: settings.temperature,
      maxTokens: settings.maxTokens,
      systemPrompt: settings.systemPrompt,
      ...(session?.settingsOverride ?? {}),
    };

    const history = get().messages.filter(
      (m) => m.id !== assistantMsg.id && m.content
    );
    // 本轮用户消息发给模型时用 modelContent（含文档正文），而非落库的短显示文本
    const historyForModel = history.map((m) =>
      m.id === userMsg.id ? { ...m, content: modelContent } : m
    );
    const chatMessages = buildChatMessages(historyForModel, effective);

    const inst = makeProvider(provider);
    const controller = new AbortController();
    set({ abortController: controller });

    // 联网搜索工具（开关打开且有 Tavily key 时启用）
    const { tools, executeTool } = await buildTools(get);

    // 用闭包捕获本次 controller，回调里校验归属，防止被新流式覆盖（竞态保护）
    const myController = controller;
    const isMine = () => get().abortController === myController;

    let acc = '';
    let aborted = false;
    await inst.streamChat(
      { messages: chatMessages, settings: effective, apiKey, signal: controller.signal, tools, executeTool },
      {
        onToolCall: (name) => {
          if (name === 'web_search' && isMine()) set({ searching: true });
        },
        onDelta: (delta) => {
          if (!isMine()) return; // 已被新流式接管，丢弃
          acc += delta;
          set((s) => ({
            searching: false,
            messages: s.messages.map((m) =>
              m.id === assistantMsg.id ? { ...m, content: acc } : m
            ),
          }));
        },
        onDone: async () => {
          if (myController.signal.aborted) aborted = true;
          if (!isMine()) return; // 已被新流式接管，不写状态
          try {
            await db.updateMessage(assistantMsg.id, { content: acc, status: 'done' });
          } catch {
            // db 写入失败不阻塞状态复位
          }
          set((s) => ({
            isStreaming: false,
            searching: false,
            abortController: null,
            messages: s.messages.map((m) =>
              m.id === assistantMsg.id ? { ...m, status: 'done' } : m
            ),
          }));
          // abort 时不触发自动命名（acc 可能残缺）
          if (!aborted) get().maybeAutoTitle(sessionId!, content, acc);
        },
        onError: async (err) => {
          if (!isMine()) return; // 已被新流式接管，不写状态
          try {
            await db.updateMessage(assistantMsg.id, {
              content: acc,
              status: 'error',
              error: err.message,
            });
          } catch {
            // db 写入失败不阻塞状态复位
          }
          set((s) => ({
            isStreaming: false,
            searching: false,
            abortController: null,
            messages: s.messages.map((m) =>
              m.id === assistantMsg.id
                ? { ...m, status: 'error', error: err.message }
                : m
            ),
          }));
        },
      }
    );
  },

  // 自动命名：仅当会话仍是默认标题时，用当前模型总结一个短标题
  async maybeAutoTitle(sessionId, userText, replyText) {
    const session = get().sessions.find((x) => x.id === sessionId);
    if (!session || session.title !== '新对话') return;
    const { settings } = get();
    const provider = curProvider(settings);
    if (!provider) return;
    const apiKey = await getProviderKey(provider.id);
    if (!apiKey) return;

    try {
      const inst = makeProvider(provider);
      const prompt =
        '用不超过12个字概括下面对话的主题，只输出标题本身，不要标点、引号或解释。\n\n' +
        `用户：${userText.slice(0, 200)}\n助手：${replyText.slice(0, 200)}`;
      const raw = await inst.complete({
        messages: [{ role: 'user', content: prompt }],
        settings: { model: settings.currentModel, temperature: 0.3, maxTokens: 32 },
        apiKey,
      });
      const title = raw.trim().replace(/^["'「」]+|["'「」]+$/g, '').slice(0, 20);
      if (!title) return;
      await db.updateSession(sessionId, { title, updatedAt: Date.now() });
      set((s) => ({
        sessions: s.sessions.map((x) =>
          x.id === sessionId ? { ...x, title } : x
        ),
      }));
    } catch {
      // 总结失败不影响对话，回退用首句
      const fallback = userText.slice(0, 20);
      await db.updateSession(sessionId, { title: fallback });
      set((s) => ({
        sessions: s.sessions.map((x) =>
          x.id === sessionId ? { ...x, title: fallback } : x
        ),
      }));
    }
  },

  stopStreaming() {
    const controller = get().abortController;
    if (!controller) return;

    // abort 前先保存当前 streaming 消息（防止 onDone 因 isMine 失败而跳过 DB 写入）
    const messages = get().messages;
    const streamingMsg = messages.find((m) => m.status === 'streaming');
    if (streamingMsg) {
      db.updateMessage(streamingMsg.id, { content: streamingMsg.content, status: 'done' }).catch(() => {});
    }

    controller.abort();
    set((s) => ({
      isStreaming: false,
      searching: false,
      abortController: null,
      messages: s.messages.map((m) =>
        m.status === 'streaming' ? { ...m, status: 'done' } : m
      ),
    }));
  },

  // 删除单条消息
  async deleteMessage(id) {
    if (get().isStreaming) return;
    await db.deleteMessage(id);
    set((s) => ({ messages: s.messages.filter((m) => m.id !== id) }));
  },

  // 重新生成：删掉该 assistant 消息及其之后的所有消息，重新流式生成
  async regenerate(assistantId) {
    if (get().isStreaming) return;
    const msgs = get().messages;
    const target = msgs.find((m) => m.id === assistantId);
    if (!target || target.role !== 'assistant') return;
    const sessionId = target.sessionId;
    // 删掉这条 assistant（含）之后的所有消息
    await db.deleteMessagesFrom(sessionId, target.createdAt);
    set((s) => ({
      messages: s.messages.filter((m) => m.createdAt < target.createdAt),
    }));
    await streamReply(get, set, sessionId);
  },

  // 编辑用户消息后重发：改写该 user 消息，删掉其后所有消息，重新生成
  async editAndResend(userId, newText) {
    if (get().isStreaming) return;
    const text = newText.trim();
    if (!text) return;
    const msgs = get().messages;
    const target = msgs.find((m) => m.id === userId);
    if (!target || target.role !== 'user') return;
    const sessionId = target.sessionId;
    // 删掉该 user 消息之后的所有消息（保留这条 user 本身）
    await db.deleteMessagesFrom(sessionId, target.createdAt + 1);
    await db.updateMessage(userId, { content: text });
    set((s) => ({
      messages: s.messages
        .filter((m) => m.createdAt <= target.createdAt)
        .map((m) => (m.id === userId ? { ...m, content: text } : m)),
    }));
    await streamReply(get, set, sessionId, { userText: text });
  },

  async updateOcr(patch) {
    const next = { ...get().settings, ocr: { ...get().settings.ocr, ...patch } };
    await saveSettings(next);
    set({ settings: next });
  },

  async saveOcrKey(key) {
    await setOcrKey(key);
  },

  // 联网搜索
  toggleWebSearch() {
    set((s) => ({ webSearchEnabled: !s.webSearchEnabled }));
  },

  async saveTavilyKey(key) {
    const trimmed = key.trim();
    if (trimmed) {
      await setTavilyKeySecret(trimmed);
      set({ tavilyReady: true });
    } else {
      await deleteTavilyKeySecret();
      set({ tavilyReady: false, webSearchEnabled: false });
    }
  },

  async deleteTavilyKey() {
    await deleteTavilyKeySecret();
    set({ tavilyReady: false, webSearchEnabled: false });
  },

  async saveLlamaParseKey(key) {
    const trimmed = key.trim();
    if (trimmed) {
      await setLlamaParseKeySecret(trimmed);
      set({ llamaparseReady: true });
    } else {
      await deleteLlamaParseKeySecret();
      set({ llamaparseReady: false });
    }
  },

  async deleteLlamaParseKey() {
    await deleteLlamaParseKeySecret();
    set({ llamaparseReady: false });
  },

  // 解析一个文件，返回带正文的待发送附件（含 parsing→done/error 状态）
  async parseAttachment(file) {
    const { ocr } = get().settings;
    const base: PendingAttachment = {
      id: genId(),
      name: file.name,
      kind: 'text',
      status: 'parsing',
      text: '',
    };
    try {
      const [ocrKey, llamaParseKey] = await Promise.all([
        getOcrKey(),
        getLlamaParseKey(),
      ]);
      const result = await parseFile(
        file,
        { baseURL: ocr.baseURL, model: ocr.model, apiKey: ocrKey ?? '' },
        llamaParseKey ? { apiKey: llamaParseKey } : undefined
      );
      return {
        ...base,
        kind: result.kind,
        status: 'done',
        text: result.text,
        chars: result.text.length,
      };
    } catch (e: any) {
      return { ...base, status: 'error', error: e?.message ?? String(e) };
    }
  },
}));
