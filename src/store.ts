// 聊天状态管理 —— Zustand
// 会话/消息状态 + 多服务商 + 发送消息 + 流式 + 自动命名 + 持久化

import { create } from 'zustand';
import type {
  AppSettings,
  Attachment,
  ConversationSettings,
  Message,
  MessageQuote,
  ModelSettings,
  Provider,
  Session,
  ToolResult,
  ToolSource,
} from './types';
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
  deleteOcrKey,
  getTavilyKey,
  setTavilyKey as setTavilyKeySecret,
  deleteTavilyKey as deleteTavilyKeySecret,
  getLlamaParseKey,
  setLlamaParseKey as setLlamaParseKeySecret,
  deleteLlamaParseKey as deleteLlamaParseKeySecret,
  getAliyunAccessKeyId,
  setAliyunAccessKeyId,
  deleteAliyunAccessKeyId,
  getAliyunAccessKeySecret,
  setAliyunAccessKeySecret,
  deleteAliyunAccessKeySecret,
} from './settings';
import { makeProvider } from './providers/factory';
import { buildChatMessages, type ToolDef, type ToolExecutor } from './providers/base';
import { getEnabledTools, makeToolExecutor } from './tools';
import { parseFile, type PickedFile } from './parse';
import {
  DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS,
  modelContextKey,
  prepareContext,
} from './context';

// 待发送的附件（含解析出的文本，发送时拼进 content）
export interface PendingAttachment extends Attachment {
  text: string; // 解析出的正文
}

interface ActiveStream {
  sessionId: string;
  assistantId: string;
  content: string;
  toolResults: ToolResult[];
}

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function nextMessageCreatedAt(history: Message[]): number {
  const previous = history.length ? history[history.length - 1].createdAt : 0;
  return Math.max(Date.now(), previous + 1);
}

const MAX_ATTACHMENT_CONTEXT_CHARS = 60_000;
const ATTACHMENT_TRUNCATED_MARKER = '\n\n…（本轮附件总内容过长，已截断）';

function buildAttachmentContext(attachments: PendingAttachment[]): string {
  const full = attachments
    .map((attachment) => `[文档：${attachment.name}]\n${attachment.text}`)
    .join('\n\n');
  if (full.length <= MAX_ATTACHMENT_CONTEXT_CHARS) return full;
  return full.slice(
    0,
    MAX_ATTACHMENT_CONTEXT_CHARS - ATTACHMENT_TRUNCATED_MARKER.length
  ) + ATTACHMENT_TRUNCATED_MARKER;
}

function parseSearchSources(content: string): ToolSource[] {
  const sources: ToolSource[] = [];
  const pattern = /\[\d+\]\s+([^\n]*)\nURL:\s*([^\n]+)\n([\s\S]*?)(?=\n\n\[\d+\]\s|$)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content))) {
    sources.push({
      title: match[1].trim(),
      url: match[2].trim(),
      content: match[3].trim(),
    });
  }
  return sources;
}

function makeToolResult(name: string, args: any, content: string): ToolResult {
  const sources = name === 'web_search' ? parseSearchSources(content) : [];
  return {
    id: genId(),
    toolName: name,
    query: typeof args?.query === 'string' ? args.query.trim() : undefined,
    content,
    sources: sources.length ? sources : undefined,
  };
}

function sortSessions(sessions: Session[]): Session[] {
  return [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
}

async function touchSession(
  set: (partial: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>)) => void,
  sessionId: string,
  updatedAt: number
): Promise<void> {
  await db.updateSession(sessionId, { updatedAt });
  set((s) => ({
    sessions: sortSessions(
      s.sessions.map((session) =>
        session.id === sessionId ? { ...session, updatedAt } : session
      )
    ),
  }));
}

// 构造联网搜索工具配置（开关打开且有 Tavily key 时才启用）
async function buildTools(
  get: () => ChatState
): Promise<{ tools?: ToolDef[]; executeTool?: ToolExecutor }> {
  if (!get().webSearchEnabled) return {};
  const tavilyKey = await getTavilyKey();
  if (!tavilyKey) return {};
  return {
    tools: getEnabledTools(),
    executeTool: makeToolExecutor(tavilyKey, get().settings.tavilySearchDepth),
  };
}

interface ChatPreflight {
  provider: Provider;
  apiKey: string;
  effective: ModelSettings;
}

// 所有可能导致“无法开始生成”的配置检查都在破坏历史前完成。
async function preflightChat(
  get: () => ChatState,
  sessionId: string | null
): Promise<ChatPreflight> {
  const { settings } = get();
  const provider = curProvider(settings);
  if (!provider) throw new Error('请先在设置里添加一个服务商');
  const apiKey = await getProviderKey(provider.id);
  if (!apiKey) throw new Error(`请先为「${provider.name}」填写 API Key`);
  if (!settings.currentModel) throw new Error('请先选择一个模型');

  const session = sessionId
    ? get().sessions.find((x) => x.id === sessionId)
    : undefined;
  const effective: ModelSettings = {
    model: settings.currentModel,
    temperature: settings.temperature,
    topP: settings.topP,
    maxTokens: settings.maxTokens,
    systemPrompt: settings.systemPrompt,
    ...(session?.settingsOverride ?? {}),
  };
  if (!effective.model) throw new Error('请先选择一个模型');
  if (!provider.models.includes(effective.model)) {
    throw new Error('当前会话所选模型已不存在，请重新选择模型');
  }
  return { provider, apiKey, effective };
}

async function replaceAliyunDocKeys(
  nextId: string | null,
  nextSecret: string | null
): Promise<void> {
  const previousId = await getAliyunAccessKeyId();
  const previousSecret = await getAliyunAccessKeySecret();
  try {
    if (nextId) await setAliyunAccessKeyId(nextId);
    else await deleteAliyunAccessKeyId();

    if (nextSecret) await setAliyunAccessKeySecret(nextSecret);
    else await deleteAliyunAccessKeySecret();
  } catch (error) {
    // SecureStore 没有事务；失败时尽力恢复调用前的成对状态。
    try {
      if (previousId) await setAliyunAccessKeyId(previousId);
      else await deleteAliyunAccessKeyId();
    } catch {}
    try {
      if (previousSecret) await setAliyunAccessKeySecret(previousSecret);
      else await deleteAliyunAccessKeySecret();
    } catch {}
    throw error;
  }
}

// 共享流式逻辑：在 sessionId 下，基于持久化历史新建 assistant 占位并流式生成
async function streamReply(
  get: () => ChatState,
  set: (partial: Partial<ChatState> | ((s: ChatState) => Partial<ChatState>)) => void,
  sessionId: string,
  onTitle?: { userText: string },
  prepared?: ChatPreflight
): Promise<void> {
  const { provider, apiKey, effective } = prepared ?? await preflightChat(get, sessionId);

  // 请求历史始终取指定会话的数据库快照，不依赖当前 UI 正在显示哪个会话。
  const history = await db.listMessages(sessionId);
  const session = get().sessions.find((item) => item.id === sessionId);
  const contextWindowTokens = get().settings.modelContextWindows[
    modelContextKey(provider.id, effective.model)
  ] ?? DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS;
  const context = prepareContext(
    history,
    effective.systemPrompt,
    {
      autoCompress: !!session?.conversationSettings?.autoCompressContext,
      contextWindowTokens,
      reservedOutputTokens: effective.maxTokens,
    }
  );
  const chatMessages = buildChatMessages(context.history, effective, context.summary);
  const inst = makeProvider(provider);
  const { tools, executeTool } = await buildTools(get);

  const assistantMsg: Message = {
    id: genId(),
    sessionId,
    role: 'assistant',
    content: '',
    createdAt: nextMessageCreatedAt(history),
    status: 'streaming',
  };
  const controller = new AbortController();
  await db.insertMessage(assistantMsg);
  await touchSession(set, sessionId, assistantMsg.createdAt);
  set((s) => ({
    messages:
      s.currentSessionId === sessionId
        && !s.messages.some((message) => message.id === assistantMsg.id)
        ? [...s.messages, assistantMsg]
        : s.messages,
    isStreaming: true,
    abortController: controller,
    activeStream: { sessionId, assistantId: assistantMsg.id, content: '', toolResults: [] },
  }));

  // 用闭包捕获本次 controller，回调里校验归属，防止被新流式覆盖（竞态保护）
  const myController = controller;
  const isMine = () => {
    const active = get().activeStream;
    return get().abortController === myController
      && active?.sessionId === sessionId
      && active.assistantId === assistantMsg.id;
  };

  let acc = '';
  let toolResults: ToolResult[] = [];
  let aborted = false;
  await inst.streamChat(
    { messages: chatMessages, settings: effective, apiKey, signal: controller.signal, tools, executeTool },
    {
      onToolCall: (name) => {
        if (name === 'web_search' && isMine()) set({ searching: true });
      },
      onToolResult: (name, args, result) => {
        if (!isMine()) return;
        toolResults = [...toolResults, makeToolResult(name, args, result)];
        void db.updateMessage(assistantMsg.id, { toolResults }).catch(() => {});
        set((s) => {
          const active = s.activeStream;
          if (active?.assistantId !== assistantMsg.id || active.sessionId !== sessionId) {
            return {};
          }
          return {
            searching: false,
            activeStream: { ...active, toolResults },
            messages: s.currentSessionId === sessionId
              ? s.messages.map((message) =>
                  message.id === assistantMsg.id ? { ...message, toolResults } : message
                )
              : s.messages,
          };
        });
      },
      onDelta: (delta) => {
        if (!isMine()) return; // 已被新流式接管，丢弃
        acc += delta;
        set((s) => {
          const active = s.activeStream;
          if (active?.assistantId !== assistantMsg.id || active.sessionId !== sessionId) {
            return {};
          }
          return {
            searching: false,
            activeStream: { ...active, content: acc },
            messages:
              s.currentSessionId === sessionId
                ? s.messages.map((m) =>
                    m.id === assistantMsg.id ? { ...m, content: acc } : m
                  )
                : s.messages,
          };
        });
      },
      onDone: async () => {
        // abort 场景 provider 也走 onDone，这里标记
        if (myController.signal.aborted) aborted = true;
        if (!isMine()) return; // 已被新流式接管，不写状态
        try {
          await db.updateMessage(assistantMsg.id, {
            content: acc,
            status: 'done',
            toolResults,
          });
        } catch {
          // db 写入失败不阻塞状态复位
        }
        if (!isMine()) return;
        set((s) => ({
          isStreaming: false,
          searching: false,
          abortController: null,
          activeStream: null,
          messages:
            s.currentSessionId === sessionId
              ? s.messages.map((m) =>
                  m.id === assistantMsg.id
                    ? { ...m, content: acc, status: 'done', toolResults }
                    : m
                )
              : s.messages,
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
            toolResults,
          });
        } catch {
          // db 写入失败不阻塞状态复位
        }
        if (!isMine()) return;
        set((s) => ({
          isStreaming: false,
          searching: false,
          abortController: null,
          activeStream: null,
          messages:
            s.currentSessionId === sessionId
              ? s.messages.map((m) =>
                  m.id === assistantMsg.id
                    ? { ...m, content: acc, status: 'error', error: err.message, toolResults }
                    : m
                )
              : s.messages,
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
  activeStream: ActiveStream | null;

  // 联网搜索
  webSearchEnabled: boolean; // 联网开关（运行时状态，不持久化）
  tavilyReady: boolean; // 是否已配置 Tavily key

  // LlamaParse 文档解析
  llamaparseReady: boolean; // 是否已配置 LlamaParse key
  aliyunDocReady: boolean; // 是否已配置阿里云文档解析 AK

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
  updateConversationSettings: (
    id: string,
    modelPatch: Partial<ModelSettings>,
    conversationPatch: Partial<ConversationSettings>
  ) => Promise<void>;
  insertTopicBoundary: () => Promise<void>;

  // 消息
  sendMessage: (
    text: string,
    attachments?: PendingAttachment[],
    quote?: MessageQuote
  ) => Promise<void>;
  stopStreaming: () => Promise<void>;
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
  saveAliyunDocKeys: (accessKeyId: string, accessKeySecret: string) => Promise<void>;
  deleteAliyunDocKeys: () => Promise<void>;
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
  activeStream: null,
  webSearchEnabled: false,
  tavilyReady: false,
  llamaparseReady: false,
  aliyunDocReady: false,
  themeMode: 'system',

  async init() {
    await db.markInterruptedMessages();
    const [settings, sessions] = await Promise.all([
      loadSettings(),
      db.listSessions(),
    ]);
    const prov = curProvider(settings);
    const key = prov ? await getProviderKey(prov.id) : null;
    const tavilyKey = await getTavilyKey();
    const llamaParseKey = await getLlamaParseKey();
    const [aliyunKeyId, aliyunSecret] = await Promise.all([
      getAliyunAccessKeyId(),
      getAliyunAccessKeySecret(),
    ]);
    set({
      settings,
      themeMode: settings.theme,
      sessions,
      keyReady: !!key,
      tavilyReady: !!tavilyKey,
      llamaparseReady: !!llamaParseKey,
      aliyunDocReady: !!aliyunKeyId && !!aliyunSecret,
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
    const current = get().settings;
    let currentModel = current.currentModel;
    if (current.currentProviderId === id) {
      const updated = providers.find((p) => p.id === id);
      if (updated && !updated.models.includes(currentModel)) {
        currentModel = updated.models[0] ?? '';
      }
    }
    const next = { ...current, providers, currentModel };
    await saveSettings(next);
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
    const trimmed = key.trim();
    if (trimmed) await setProviderKey(id, trimmed);
    else await deleteProviderKey(id);
    if (id === get().settings.currentProviderId) {
      set({ keyReady: !!trimmed });
    }
  },

  async selectModel(providerId, model) {
    const provider = get().settings.providers.find((p) => p.id === providerId);
    if (!provider || !provider.models.includes(model)) {
      throw new Error('所选模型已不存在，请刷新模型列表后重试');
    }
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
      sessions: sortSessions(
        s.sessions.map((x) =>
          x.id === id ? { ...x, title: t, updatedAt: now } : x
        )
      ),
    }));
  },

  async updateConversationSettings(id, modelPatch, conversationPatch) {
    const current = get().sessions.find((session) => session.id === id);
    if (!current) throw new Error('当前对话不存在');
    const settingsOverride = { ...(current.settingsOverride ?? {}), ...modelPatch };
    const conversationSettings = {
      ...(current.conversationSettings ?? {}),
      ...conversationPatch,
    };
    await db.updateSession(id, { settingsOverride, conversationSettings });
    set((s) => ({
      sessions: s.sessions.map((session) =>
        session.id === id
          ? { ...session, settingsOverride, conversationSettings }
          : session
      ),
    }));
  },

  async insertTopicBoundary() {
    if (get().isStreaming) return;
    let sessionId = get().currentSessionId;
    if (!sessionId) sessionId = await get().newSession();
    const history = await db.listMessages(sessionId);
    const boundary: Message = {
      id: genId(),
      sessionId,
      role: 'system',
      content: '新话题',
      createdAt: nextMessageCreatedAt(history),
      status: 'done',
      topicBoundary: true,
    };
    await db.insertMessage(boundary);
    await touchSession(set, sessionId, boundary.createdAt);
    set((s) => ({
      messages: s.currentSessionId === sessionId ? [...s.messages, boundary] : s.messages,
    }));
  },

  async sendMessage(text, attachments, quote) {
    const content = text.trim();
    const atts = (attachments ?? []).filter((a) => a.status === 'done');
    // 允许「只有附件、没文字」的发送
    if ((!content && !atts.length) || get().isStreaming) return;

    let sessionId = get().currentSessionId;
    const prepared = await preflightChat(get, sessionId);
    if (!sessionId) sessionId = await get().newSession();

    const attachmentContext = atts.length
      ? buildAttachmentContext(atts)
      : undefined;
    const history = await db.listMessages(sessionId);
    const now = nextMessageCreatedAt(history);
    const userMsg: Message = {
      id: genId(),
      sessionId,
      role: 'user',
      content,
      createdAt: now,
      status: 'done',
      attachments: atts.length
        ? atts.map(({ text, ...meta }) => ({ ...meta, parsedText: text }))
        : undefined,
      attachmentContext,
      quote,
    };

    await db.insertMessage(userMsg);
    set((s) => ({
      messages:
        s.currentSessionId === sessionId
          && !s.messages.some((message) => message.id === userMsg.id)
          ? [...s.messages, userMsg]
          : s.messages,
    }));
    const titleText = content || atts.map((a) => a.name).join('、') || '文档对话';
    await streamReply(get, set, sessionId, { userText: titleText }, prepared);
  },

  // 自动命名：仅当会话仍是默认标题时，用当前模型总结一个短标题
  async maybeAutoTitle(sessionId, userText, replyText) {
    const session = get().sessions.find((x) => x.id === sessionId);
    if (!session || session.title !== '新对话') return;
    const { settings } = get();
    const localTitle = userText.replace(/\s+/g, ' ').trim().slice(0, 20) || '文档对话';
    const applyTitle = async (title: string) => {
      await db.updateSession(sessionId, { title });
      set((s) => ({
        sessions: s.sessions.map((x) =>
          x.id === sessionId ? { ...x, title } : x
        ),
      }));
    };

    if (settings.autoTitleMode !== 'ai') {
      await applyTitle(localTitle);
      return;
    }

    const provider = curProvider(settings);
    if (!provider) {
      await applyTitle(localTitle);
      return;
    }
    const apiKey = await getProviderKey(provider.id);
    if (!apiKey) {
      await applyTitle(localTitle);
      return;
    }

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
      await applyTitle(title || localTitle);
    } catch {
      // 总结失败不影响对话，回退用首句
      await applyTitle(localTitle);
    }
  },

  async stopStreaming() {
    const { abortController: controller, activeStream } = get();
    if (!controller || !activeStream) return;

    // 精确结束本次请求；旧的遗留 streaming 行不会再被误命中。
    controller.abort();
    set((s) => ({
      isStreaming: false,
      searching: false,
      abortController: null,
      activeStream: null,
      messages:
        s.currentSessionId === activeStream.sessionId
          ? s.messages.map((m) =>
              m.id === activeStream.assistantId
                ? {
                    ...m,
                    content: activeStream.content,
                    status: 'done',
                    toolResults: activeStream.toolResults,
                  }
                : m
            )
          : s.messages,
    }));
    try {
      await db.updateMessage(activeStream.assistantId, {
        content: activeStream.content,
        status: 'done',
        toolResults: activeStream.toolResults,
      });
    } catch {
      // 停止动作本身仍应立即生效；数据库异常会在下次启动时被恢复逻辑标记。
    }
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
    const prepared = await preflightChat(get, sessionId);
    // 删掉这条 assistant（含）之后的所有消息
    await db.deleteMessagesFrom(sessionId, target.createdAt);
    set((s) => ({
      messages:
        s.currentSessionId === sessionId
          ? s.messages.filter((m) => m.createdAt < target.createdAt)
          : s.messages,
    }));
    await streamReply(get, set, sessionId, undefined, prepared);
  },

  // 编辑用户消息后重发：改写该 user 消息，删掉其后所有消息，重新生成
  async editAndResend(userId, newText) {
    if (get().isStreaming) return;
    const msgs = get().messages;
    const target = msgs.find((m) => m.id === userId);
    if (!target || target.role !== 'user') return;
    const text = newText.trim();
    if (!text && !target.attachmentContext) return;
    const sessionId = target.sessionId;
    const prepared = await preflightChat(get, sessionId);
    // 删掉该 user 消息之后的所有消息（保留这条 user 本身）
    await db.deleteMessagesFrom(sessionId, target.createdAt + 1);
    await db.updateMessage(userId, { content: text });
    set((s) => ({
      messages:
        s.currentSessionId === sessionId
          ? s.messages
              .filter((m) => m.createdAt <= target.createdAt)
              .map((m) => (m.id === userId ? { ...m, content: text } : m))
          : s.messages,
    }));
    const titleText = text || target.attachments?.map((a) => a.name).join('、') || '文档对话';
    await streamReply(get, set, sessionId, { userText: titleText }, prepared);
  },

  async updateOcr(patch) {
    const next = { ...get().settings, ocr: { ...get().settings.ocr, ...patch } };
    await saveSettings(next);
    set({ settings: next });
  },

  async saveOcrKey(key) {
    const trimmed = key.trim();
    if (trimmed) await setOcrKey(trimmed);
    else await deleteOcrKey();
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

  async saveAliyunDocKeys(accessKeyId, accessKeySecret) {
    const id = accessKeyId.trim();
    const secret = accessKeySecret.trim();
    if (id && secret) {
      await replaceAliyunDocKeys(id, secret);
      set({ aliyunDocReady: true });
    } else {
      await replaceAliyunDocKeys(null, null);
      set({ aliyunDocReady: false });
    }
  },

  async deleteAliyunDocKeys() {
    await replaceAliyunDocKeys(null, null);
    set({ aliyunDocReady: false });
  },

  // 解析一个文件，返回带正文的待发送附件（含 parsing→done/error 状态）
  async parseAttachment(file) {
    const { ocr } = get().settings;
    const base: PendingAttachment = {
      id: genId(),
      name: file.name,
      kind: 'text',
      status: 'parsing',
      size: file.size,
      mimeType: file.mimeType,
      text: '',
    };
    try {
      const [ocrKey, llamaParseKey, aliyunKeyId, aliyunSecret] = await Promise.all([
        getOcrKey(),
        getLlamaParseKey(),
        getAliyunAccessKeyId(),
        getAliyunAccessKeySecret(),
      ]);
      const docParser = get().settings.documentParser;
      const result = await parseFile(
        file,
        { baseURL: ocr.baseURL, model: ocr.model, apiKey: ocrKey ?? '' },
        docParser.provider === 'aliyun'
          ? {
              provider: 'aliyun',
              aliyun:
                aliyunKeyId && aliyunSecret
                  ? {
                      accessKeyId: aliyunKeyId,
                      accessKeySecret: aliyunSecret,
                      endpoint: docParser.aliyun.endpoint,
                      llmEnhancement: docParser.aliyun.llmEnhancement,
                      enhancementMode: docParser.aliyun.enhancementMode,
                      oss: docParser.aliyun.oss,
                    }
                  : undefined,
            }
          : {
              provider: 'llamaparse',
              llamaParse: llamaParseKey ? { apiKey: llamaParseKey } : undefined,
            }
      );
      return {
        ...base,
        kind: result.kind,
        status: 'done',
        text: result.text,
        chars: result.text.length,
      };
    } catch (e: any) {
      const message = e?.message ?? String(e);
      return { ...base, status: 'error', error: message };
    }
  },
}));
