// 聊天界面 —— 消息列表 + 输入框 + 流式显示
// 头部=当前对话名；输入框左侧=模型选择器（按服务商分组）
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform as RNPlatform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useChatStore, type PendingAttachment } from '../store';
import type { Message } from '../types';
import { useTheme, darkTheme, type ThemeColors } from '../theme';
import Markdown from 'react-native-markdown-display';
import { MathView } from './MathView';
import { MermaidView } from './MermaidView';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';

export default function ChatScreen({
  onOpenDrawer,
  onOpenSettings,
}: {
  onOpenDrawer: () => void;
  onOpenSettings: () => void;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const keyReady = useChatStore((s) => s.keyReady);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const stopStreaming = useChatStore((s) => s.stopStreaming);
  const providers = useChatStore((s) => s.settings.providers);
  const currentModel = useChatStore((s) => s.settings.currentModel);
  const currentProviderId = useChatStore((s) => s.settings.currentProviderId);
  const selectModel = useChatStore((s) => s.selectModel);
  const sessions = useChatStore((s) => s.sessions);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const parseAttachment = useChatStore((s) => s.parseAttachment);
  const deleteMessage = useChatStore((s) => s.deleteMessage);
  const regenerate = useChatStore((s) => s.regenerate);
  const editAndResend = useChatStore((s) => s.editAndResend);
  const webSearchEnabled = useChatStore((s) => s.webSearchEnabled);
  const searching = useChatStore((s) => s.searching);
  const tavilyReady = useChatStore((s) => s.tavilyReady);
  const toggleWebSearch = useChatStore((s) => s.toggleWebSearch);

  const title =
    sessions.find((x) => x.id === currentSessionId)?.title ?? 'Chatbox';

  const [input, setInput] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [attachMenu, setAttachMenu] = useState(false);
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  // 消息长按操作菜单 + 编辑弹窗
  const [actionMsg, setActionMsg] = useState<Message | null>(null);
  const [editMsg, setEditMsg] = useState<Message | null>(null);
  const [editText, setEditText] = useState('');
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // 注册图片预览回调（供 MarkdownImage 调用）
  useEffect(() => {
    _onPreviewImage = (uri: string) => setPreviewImage(uri);
    return () => { _onPreviewImage = null; };
  }, []);
  const listRef = useRef<FlatList<Message>>(null);
  const nearBottomRef = useRef(true);

  // 用户向上翻阅历史时，不强制滚到底部（仅当靠近底部时才自动滚动）
  useEffect(() => {
    if (messages.length && nearBottomRef.current) {
      listRef.current?.scrollToEnd({ animated: true });
    }
  }, [messages]);

  // 错误消息 4 秒后自动消失
  useEffect(() => {
    if (err) {
      const t = setTimeout(() => setErr(null), 4000);
      return () => clearTimeout(t);
    }
  }, [err]);

  const parsing = pending.some((a) => a.status === 'parsing');

  // 解析一个选中的文件：先插入 parsing 占位，完成后替换
  async function runParse(file: { uri: string; name: string; mimeType?: string }) {
    const placeholder: PendingAttachment = {
      id: Math.random().toString(36).slice(2),
      name: file.name,
      kind: /\.(png|jpe?g|webp|gif|bmp|heic)$/i.test(file.name) ? 'image' : 'text',
      status: 'parsing',
      text: '',
    };
    setPending((p) => [...p, placeholder]);
    try {
      const result = await parseAttachment(file);
      setPending((p) => p.map((a) => (a.id === placeholder.id ? result : a)));
    } catch (e: any) {
      setPending((p) =>
        p.map((a) =>
          a.id === placeholder.id
            ? { ...a, status: 'error', error: e?.message ?? String(e) }
            : a
        )
      );
    }
  }

  async function pickDocument() {
    setAttachMenu(false);
    const res = await DocumentPicker.getDocumentAsync({
      type: [
        'text/*',
        'application/json',
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
        'application/vnd.ms-powerpoint',
        'application/vnd.oasis.opendocument.*',
        'application/rtf',
        'application/epub+zip',
      ],
      copyToCacheDirectory: false,
    });
    if (res.canceled || !res.assets?.length) return;
    const a = res.assets[0];
    runParse({ uri: a.uri, name: a.name ?? '文件', mimeType: a.mimeType });
  }

  async function pickImage() {
    setAttachMenu(false);
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
    });
    if (res.canceled || !res.assets?.length) return;
    const a = res.assets[0];
    const name = a.fileName ?? `image_${Date.now()}.jpg`;
    runParse({ uri: a.uri, name, mimeType: a.mimeType ?? 'image/jpeg' });
  }

  function removePending(id: string) {
    setPending((p) => p.filter((a) => a.id !== id));
  }

  async function handleSend() {
    const text = input.trim();
    const ready = pending.filter((a) => a.status === 'done');
    if ((!text && !ready.length) || isStreaming || parsing) return;
    setInput('');
    setErr(null);
    const toSend = ready;
    setPending([]);
    try {
      await sendMessage(text, toSend);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    }
  }

  async function copyMsg(m: Message) {
    await Clipboard.setStringAsync(m.content);
    setActionMsg(null);
  }
  function startEdit(m: Message) {
    setActionMsg(null);
    setEditText(m.content);
    setEditMsg(m);
  }
  async function commitEdit() {
    if (editMsg) {
      const m = editMsg;
      setEditMsg(null);
      try {
        await editAndResend(m.id, editText);
      } catch (e: any) {
        setErr(e?.message ?? String(e));
      }
    }
  }
  async function doRegenerate(m: Message) {
    setActionMsg(null);
    try {
      await regenerate(m.id);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    }
  }
  async function doDelete(m: Message) {
    setActionMsg(null);
    await deleteMessage(m.id);
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={RNPlatform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <Pressable onPress={onOpenDrawer} hitSlop={8} style={styles.headerSide}>
          <Text style={styles.menuIcon}>☰</Text>
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.headerSide} />
      </View>

      {!keyReady && (
        <Pressable style={styles.banner} onPress={onOpenSettings}>
          <Text style={styles.bannerText}>
            当前服务商还没配置 API Key，点这里去设置 →
          </Text>
        </Pressable>
      )}

      <FlatList
        ref={listRef}
        style={styles.flex}
        contentContainerStyle={styles.listContent}
        data={messages}
        keyExtractor={(m) => m.id}
        renderItem={({ item }) => (
          <MessageBubble msg={item} onLongPress={() => setActionMsg(item)} />
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>开始你的第一句对话吧</Text>
        }
        onScroll={(e) => {
          const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
          const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
          nearBottomRef.current = distanceFromBottom < 100;
        }}
        scrollEventThrottle={16}
      />

      {err && <Text style={styles.error}>{err}</Text>}

      {pending.length > 0 && (
        <View style={styles.pendingBar}>
          {pending.map((a) => (
            <View key={a.id} style={styles.pendChip}>
              <Text style={styles.pendIcon}>{a.kind === 'image' ? '🖼' : '📄'}</Text>
              <Text style={styles.pendName} numberOfLines={1}>{a.name}</Text>
              {a.status === 'parsing' ? (
                <ActivityIndicator size="small" style={styles.pendSpin} color={theme.textSecondary} />
              ) : a.status === 'error' ? (
                <Text style={styles.pendErr}>✗</Text>
              ) : (
                <Text style={styles.pendOk}>✓</Text>
              )}
              <Pressable onPress={() => removePending(a.id)} hitSlop={8}>
                <Text style={styles.pendClose}>✕</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}

      <View style={styles.toolBar}>
        <Pressable
          style={[styles.webBtn, webSearchEnabled && styles.webBtnActive, isStreaming && styles.webBtnDisabled]}
          onPress={toggleWebSearch}
          disabled={isStreaming}
        >
          <Text style={styles.webIcon}>🌐</Text>
          <Text style={[styles.webText, webSearchEnabled && styles.webTextActive]}>
            联网搜索
          </Text>
        </Pressable>
        {searching && (
          <View style={styles.searchingBar}>
            <ActivityIndicator size="small" color={theme.textSecondary} />
            <Text style={styles.searchingText}>正在搜索…</Text>
          </View>
        )}
      </View>
      {webSearchEnabled && !tavilyReady && (
        <Pressable style={styles.webWarn} onPress={onOpenSettings}>
          <Text style={styles.webWarnText}>未配置 Tavily Key，点这里去设置 →</Text>
        </Pressable>
      )}

      <View style={styles.inputRow}>
        <Pressable style={styles.attachBtn} onPress={() => setAttachMenu(true)}>
          <Text style={styles.attachIcon}>📎</Text>
        </Pressable>
        <Pressable style={styles.modelBtn} onPress={() => setPickerOpen(true)}>
          <Text style={styles.modelBtnText} numberOfLines={1}>
            {shortModelName(currentModel) || '选模型'}
          </Text>
          <Text style={styles.modelBtnCaret}>▾</Text>
        </Pressable>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="输入消息…"
          placeholderTextColor={theme.placeholder}
          multiline
          editable={!isStreaming}
        />
        {isStreaming ? (
          <Pressable style={[styles.sendBtn, styles.stopBtn]} onPress={stopStreaming}>
            <Text style={styles.sendText}>停止</Text>
          </Pressable>
        ) : (
          <Pressable
            style={[
              styles.sendBtn,
              (parsing || (!input.trim() && !pending.some((a) => a.status === 'done'))) &&
                styles.sendBtnDisabled,
            ]}
            onPress={handleSend}
            disabled={parsing || (!input.trim() && !pending.some((a) => a.status === 'done'))}
          >
            <Text style={styles.sendText}>发送</Text>
          </Pressable>
        )}
      </View>

      <Modal
        visible={attachMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setAttachMenu(false)}
      >
        <Pressable style={styles.menuBackdrop} onPress={() => setAttachMenu(false)}>
          <View style={styles.menuSheet}>
            <Pressable style={styles.menuItem} onPress={pickDocument}>
              <Text style={styles.menuText}>📄  选择文件（txt / md / csv）</Text>
            </Pressable>
            <Pressable style={styles.menuItem} onPress={pickImage}>
              <Text style={styles.menuText}>🖼  选择图片（OCR 识别）</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <Modal
        visible={pickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setPickerOpen(false)}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>选择模型</Text>
            <ScrollView style={styles.modalList}>
              {providers.map((p) => (
                <View key={p.id}>
                  <Text style={styles.groupLabel}>{p.name}</Text>
                  {p.models.length === 0 && (
                    <Text style={styles.groupEmpty}>（无模型）</Text>
                  )}
                  {p.models.map((m) => {
                    const active = m === currentModel && p.id === currentProviderId;
                    return (
                      <Pressable
                        key={p.id + m}
                        style={styles.modelRow}
                        onPress={() => {
                          selectModel(p.id, m);
                          setPickerOpen(false);
                        }}
                      >
                        <Text style={[styles.modelName, active && styles.modelNameActive]}>
                          {m}
                        </Text>
                        {active && <Text style={styles.modelCheck}>✓</Text>}
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </ScrollView>
            <Pressable
              style={styles.modelManage}
              onPress={() => {
                setPickerOpen(false);
                onOpenSettings();
              }}
            >
              <Text style={styles.modelManageText}>管理服务商和模型…</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <Modal
        visible={!!actionMsg}
        transparent
        animationType="fade"
        onRequestClose={() => setActionMsg(null)}
      >
        <Pressable style={styles.menuBackdrop} onPress={() => setActionMsg(null)}>
          <View style={styles.menuSheet}>
            <Pressable style={styles.menuItem} onPress={() => actionMsg && copyMsg(actionMsg)}>
              <Text style={styles.menuText}>📋  复制</Text>
            </Pressable>
            {actionMsg?.role === 'user' && (
              <Pressable style={styles.menuItem} onPress={() => actionMsg && startEdit(actionMsg)}>
                <Text style={styles.menuText}>✏️  编辑并重发</Text>
              </Pressable>
            )}
            {actionMsg?.role === 'assistant' && actionMsg.status !== 'streaming' && (
              <Pressable style={styles.menuItem} onPress={() => actionMsg && doRegenerate(actionMsg)}>
                <Text style={styles.menuText}>🔄  重新生成</Text>
              </Pressable>
            )}
            <Pressable style={styles.menuItem} onPress={() => actionMsg && doDelete(actionMsg)}>
              <Text style={[styles.menuText, styles.menuDanger]}>🗑  删除</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <Modal
        visible={!!editMsg}
        transparent
        animationType="fade"
        onRequestClose={() => setEditMsg(null)}
      >
        <View style={styles.editBackdrop}>
          <View style={styles.editSheet}>
            <Text style={styles.editTitle}>编辑消息</Text>
            <TextInput
              style={styles.editInput}
              value={editText}
              onChangeText={setEditText}
              multiline
              autoFocus
              placeholderTextColor={theme.placeholder}
            />
            <View style={styles.editBtns}>
              <Pressable style={styles.editCancel} onPress={() => setEditMsg(null)}>
                <Text style={styles.editCancelText}>取消</Text>
              </Pressable>
              <Pressable style={styles.editOk} onPress={commitEdit}>
                <Text style={styles.editOkText}>重发</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* 图片大图预览 */}
      <Modal visible={!!previewImage} transparent animationType="fade" onRequestClose={() => setPreviewImage(null)}>
        <View style={styles.previewOverlay}>
          <Pressable style={styles.previewClose} onPress={() => setPreviewImage(null)}>
            <Text style={styles.previewCloseText}>✕</Text>
          </Pressable>
          {previewImage && (
            <Image
              source={{ uri: previewImage }}
              style={styles.previewImage}
              resizeMode="contain"
            />
          )}
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

// deepseek-ai/DeepSeek-V3 → DeepSeek-V3
function shortModelName(m: string): string {
  if (!m) return '';
  const slash = m.lastIndexOf('/');
  return slash >= 0 ? m.slice(slash + 1) : m;
}

function MessageBubble({
  msg,
  onLongPress,
}: {
  msg: Message;
  onLongPress: () => void;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const mdStyles = useMemo(() => createMdStyles(theme), [theme]);
  const mdRules = useMemo(() => createMdRules(theme), [theme]);

  const isUser = msg.role === 'user';
  const streaming = msg.status === 'streaming';
  return (
    <View style={[styles.bubbleRow, isUser ? styles.rowRight : styles.rowLeft]}>
      <Pressable
        style={[styles.bubble, isUser ? styles.userBubble : styles.aiBubble]}
        onLongPress={onLongPress}
        delayLongPress={350}
      >
        {msg.attachments?.map((a) => (
          <View key={a.id} style={styles.attCard}>
            <Text style={styles.attIcon}>{a.kind === 'image' ? '🖼' : '📄'}</Text>
            <Text style={styles.attName} numberOfLines={1}>{a.name}</Text>
            {!!a.chars && <Text style={styles.attMeta}>{a.chars} 字</Text>}
          </View>
        ))}
        {msg.content ? (
          isUser ? (
            // 用户消息：纯文本即可
            <Text style={[styles.bubbleText, styles.userText]}>{msg.content}</Text>
          ) : (
            // AI 回复：渲染 Markdown（代码块可折叠 + LaTeX 公式 + 可点击链接/图片）
            <Markdown style={mdStyles} rules={mdRules}>
              {preprocessLatex(msg.content)}
            </Markdown>
          )
        ) : streaming ? (
          <ActivityIndicator size="small" color={theme.textSecondary} />
        ) : null}
        {msg.status === 'error' && (
          <Text style={styles.bubbleErr}>⚠ {msg.error}</Text>
        )}
      </Pressable>
    </View>
  );
}

// 可折叠代码块：超过阈值默认只显示前若干行，点击展开/收起
const COLLAPSE_LINES = 12; // 超过这么多行才折叠
const PREVIEW_LINES = 8; // 折叠时预览行数

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const lines = code.replace(/\n$/, '').split('\n');
  const collapsible = lines.length > COLLAPSE_LINES;
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const shown =
    collapsible && !expanded ? lines.slice(0, PREVIEW_LINES).join('\n') : lines.join('\n');

  async function copy() {
    await Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <View style={styles.codeWrap}>
      <View style={styles.codeHeader}>
        <Text style={styles.codeLang}>{lang || 'code'}</Text>
        <Pressable onPress={copy} hitSlop={8}>
          <Text style={styles.codeCopy}>{copied ? '✓ 已复制' : '📋 复制'}</Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Text style={styles.codeText}>{shown}</Text>
      </ScrollView>
      {collapsible && (
        <Pressable style={styles.codeToggle} onPress={() => setExpanded((v) => !v)}>
          <Text style={styles.codeToggleText}>
            {expanded ? '▲ 收起' : `▼ 展开全部（${lines.length} 行）`}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

// 预处理 markdown：把 LaTeX 公式转成可识别的标记
// $$...$$ → ```math\n...\n``` （块级，走 fence 规则）
// $...$   → `m:...`            （行内，走 code_inline 规则，m: 前缀识别）
// 注意：先处理 $$ 再处理 $，避免误吞
function preprocessLatex(src: string): string {
  if (!src.includes('$')) return src;
  let out = src;
  // 块级 $$...$$
  out = out.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => '```math\n' + tex.trim() + '\n```');
  // 行内 $...$（不跨行，且 $ 后紧跟非空白、前非空白，避免误伤金额等）
  out = out.replace(/(^|[^\\$])\$(?!\s)([^\n$]+?)(?<!\s)\$/g, (_, pre, tex) => pre + '`m:' + tex + '`');
  return out;
}

// 图片预览状态（全局，避免每条消息各自管理）
let _onPreviewImage: ((uri: string) => void) | null = null;

// 可点击的图片：点击查看大图
function MarkdownImage({ src }: { src?: string }) {
  if (!src) return null;
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={() => _onPreviewImage?.(src)}
      style={{ marginVertical: 6 }}
    >
      <Image
        source={{ uri: src }}
        style={{ width: '100%', height: 200, borderRadius: 8 }}
        resizeMode="contain"
      />
    </TouchableOpacity>
  );
}

// 覆盖渲染规则（根据主题动态生成）：
// - fence：math 语言走 MathView（块级公式），mermaid 走 MermaidView，其它走可折叠代码块
// - code_block：可折叠代码块
// - code_inline：m: 前缀走行内 MathView，其它正常
// - link：点击用系统浏览器打开
// - image：显示图片，点击查看大图
function createMdRules(theme: ThemeColors) {
  return {
    fence: (node: any) => {
      const lang = node.sourceInfo?.trim();
      if (lang === 'math') {
        return <MathView key={node.key} tex={node.content} display color={theme.textPrimary} />;
      }
      if (lang === 'mermaid') {
        return <MermaidView key={node.key} code={node.content} color={theme.textPrimary} isDark={theme === darkTheme} />;
      }
      return <CodeBlock key={node.key} code={node.content} lang={lang} />;
    },
    code_block: (node: any) => <CodeBlock key={node.key} code={node.content} />,
    code_inline: (node: any) => {
      const c: string = node.content ?? '';
      if (c.startsWith('m:')) {
        return <MathView key={node.key} tex={c.slice(2)} color={theme.textPrimary} />;
      }
      return null; // 返回 null 让默认样式生效
    },
    link: (node: any, children: any) => {
      const href = node.attributes?.href;
      if (!href) return null;
      // children 是渲染好的链接显示文字（[显示文字](href)）；
      // 为空时退回 title，再退回 href
      const hasChildren = Array.isArray(children) ? children.length > 0 : !!children;
      return (
        <Text
          key={node.key}
          style={{ color: theme.primary, textDecorationLine: 'underline' }}
          onPress={() => {
            Linking.openURL(href).catch(() => {});
          }}
        >
          {hasChildren ? children : node.attributes?.title || href}
        </Text>
      );
    },
    image: (node: any) => (
      <MarkdownImage key={node.key} src={node.attributes?.src} />
    ),
  };
}

// Markdown 渲染样式（AI 气泡底色 + 主题化文字/代码/引用颜色）
function createMdStyles(theme: ThemeColors) {
  return StyleSheet.create({
    body: { fontSize: 15, lineHeight: 22, color: theme.aiBubbleText },
    paragraph: { marginTop: 0, marginBottom: 8 },
    heading1: { fontSize: 20, fontWeight: '700', marginTop: 6, marginBottom: 6 },
    heading2: { fontSize: 18, fontWeight: '700', marginTop: 6, marginBottom: 6 },
    heading3: { fontSize: 16, fontWeight: '700', marginTop: 4, marginBottom: 4 },
    strong: { fontWeight: '700' },
    em: { fontStyle: 'italic' },
    bullet_list: { marginBottom: 4 },
    ordered_list: { marginBottom: 4 },
    list_item: { marginBottom: 2 },
    code_inline: {
      backgroundColor: theme.codeInlineBg,
      color: theme.codeInlineText,
      paddingHorizontal: 4,
      paddingVertical: 1,
      borderRadius: 4,
      fontFamily: RNPlatform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 13.5,
    },
    code_block: {
      backgroundColor: theme.codeBg,
      color: theme.codeText,
      padding: 12,
      borderRadius: 8,
      fontFamily: RNPlatform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 13,
    },
    fence: {
      backgroundColor: theme.codeBg,
      color: theme.codeText,
      padding: 12,
      borderRadius: 8,
      fontFamily: RNPlatform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 13,
    },
    blockquote: {
      backgroundColor: theme.blockquoteBg,
      borderLeftWidth: 4,
      borderLeftColor: theme.primary,
      paddingHorizontal: 10,
      paddingVertical: 4,
      marginVertical: 4,
    },
    link: { color: theme.primary },
    table: { borderWidth: 1, borderColor: theme.border, borderRadius: 4 },
    th: { padding: 6, fontWeight: '700', color: theme.aiBubbleText },
    td: { padding: 6, color: theme.aiBubbleText },
    hr: { backgroundColor: theme.border, height: 1, marginVertical: 8 },
  });
}

// 主样式（根据主题动态生成）
function createStyles(theme: ThemeColors) {
  return StyleSheet.create({
    flex: { flex: 1 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
      backgroundColor: theme.surface,
    },
    headerSide: { width: 32 },
    menuIcon: { fontSize: 22, color: theme.textPrimary },
    headerTitle: {
      flex: 1,
      textAlign: 'center',
      fontSize: 16,
      fontWeight: '600',
      marginHorizontal: 8,
      color: theme.textPrimary,
    },
    banner: { backgroundColor: theme.bannerBg, padding: 10 },
    bannerText: { color: theme.bannerText, textAlign: 'center' },
    listContent: { padding: 12, flexGrow: 1 },
    empty: { textAlign: 'center', color: theme.textTertiary, marginTop: 40 },
    bubbleRow: { marginVertical: 4, flexDirection: 'row' },
    rowLeft: { justifyContent: 'flex-start' },
    rowRight: { justifyContent: 'flex-end' },
    bubble: { maxWidth: '82%', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 },
    userBubble: { backgroundColor: theme.userBubble },
    aiBubble: { backgroundColor: theme.aiBubble },
    bubbleText: { fontSize: 15, lineHeight: 21, color: theme.aiBubbleText },
    userText: { color: theme.userBubbleText },
    bubbleErr: { color: theme.danger, fontSize: 12, marginTop: 4 },
    codeWrap: {
      backgroundColor: theme.codeBg,
      borderRadius: 8,
      marginVertical: 4,
      overflow: 'hidden',
    },
    codeHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingTop: 8,
      paddingBottom: 4,
    },
    codeLang: { color: '#9aa4b2', fontSize: 11, fontWeight: '600' },
    codeCopy: { color: '#7aa2f7', fontSize: 12, fontWeight: '600' },
    codeText: {
      color: theme.codeText,
      fontFamily: RNPlatform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 13,
      lineHeight: 19,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    codeToggle: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: '#3a3f4b',
      paddingVertical: 8,
      alignItems: 'center',
    },
    codeToggleText: { color: '#7aa2f7', fontSize: 13, fontWeight: '600' },
    error: { color: theme.danger, paddingHorizontal: 16, paddingVertical: 4 },
    attCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: 'rgba(255,255,255,0.18)',
      borderRadius: 8,
      paddingHorizontal: 8,
      paddingVertical: 6,
      marginBottom: 6,
    },
    attIcon: { fontSize: 15, marginRight: 6 },
    attName: { flex: 1, color: '#fff', fontSize: 13 },
    attMeta: { color: 'rgba(255,255,255,0.75)', fontSize: 11, marginLeft: 6 },
    pendingBar: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      paddingHorizontal: 8,
      paddingTop: 6,
    },
    pendChip: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.primaryLight,
      borderRadius: 8,
      paddingHorizontal: 8,
      paddingVertical: 5,
      marginRight: 6,
      marginBottom: 6,
      maxWidth: 220,
    },
    pendIcon: { fontSize: 13, marginRight: 4 },
    pendName: { fontSize: 12, color: theme.textPrimary, flexShrink: 1 },
    pendSpin: { marginLeft: 4, transform: [{ scale: 0.7 }] },
    pendOk: { color: '#16a34a', fontSize: 12, marginLeft: 4 },
    pendErr: { color: theme.danger, fontSize: 12, marginLeft: 4 },
    pendClose: { color: theme.textSecondary, fontSize: 12, marginLeft: 8 },
    attachBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 4,
    },
    attachIcon: { fontSize: 20 },
    menuBackdrop: {
      flex: 1,
      backgroundColor: theme.overlay,
      justifyContent: 'flex-end',
    },
    menuSheet: {
      backgroundColor: theme.background,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      paddingVertical: 8,
      paddingBottom: 28,
    },
    menuItem: { paddingVertical: 15, paddingHorizontal: 22 },
    menuText: { fontSize: 16, color: theme.textPrimary },
    menuDanger: { color: theme.danger },
    editBackdrop: {
      flex: 1,
      backgroundColor: theme.overlay,
      justifyContent: 'center',
      padding: 24,
    },
    editSheet: { backgroundColor: theme.background, borderRadius: 14, padding: 16 },
    editTitle: { fontSize: 15, fontWeight: '600', marginBottom: 10, color: theme.textPrimary },
    editInput: {
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      color: theme.textPrimary,
      minHeight: 80,
      maxHeight: 240,
      textAlignVertical: 'top',
    },
    editBtns: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 14 },
    editCancel: { paddingHorizontal: 16, paddingVertical: 8, marginRight: 8 },
    editCancelText: { color: theme.textSecondary, fontSize: 15 },
    editOk: {
      backgroundColor: theme.primary,
      borderRadius: 8,
      paddingHorizontal: 18,
      paddingVertical: 8,
    },
    editOkText: { color: '#fff', fontSize: 15, fontWeight: '600' },
    toolBar: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 6,
      backgroundColor: theme.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.borderLight,
    },
    webBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.background,
    },
    webBtnActive: {
      borderColor: theme.primary,
      backgroundColor: theme.primaryLight,
    },
    webBtnDisabled: {
      opacity: 0.5,
    },
    webIcon: { fontSize: 13, marginRight: 4 },
    webText: { fontSize: 12, color: theme.textSecondary },
    webTextActive: { color: theme.primary, fontWeight: '600' },
    searchingBar: {
      flexDirection: 'row',
      alignItems: 'center',
      marginLeft: 12,
    },
    searchingText: { fontSize: 12, color: theme.textSecondary, marginLeft: 6 },
    webWarn: { backgroundColor: theme.bannerBg, paddingHorizontal: 12, paddingVertical: 6 },
    webWarnText: { color: theme.bannerText, textAlign: 'center', fontSize: 12 },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      padding: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.border,
      backgroundColor: theme.background,
    },
    modelBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      maxWidth: 110,
      height: 40,
      paddingHorizontal: 10,
      marginRight: 6,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 20,
      backgroundColor: theme.surfaceVariant,
    },
    modelBtnText: { fontSize: 12, color: theme.textPrimary, flexShrink: 1 },
    modelBtnCaret: { fontSize: 10, color: theme.textSecondary, marginLeft: 2 },
    input: {
      flex: 1,
      maxHeight: 120,
      minHeight: 40,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 20,
      paddingHorizontal: 14,
      paddingTop: 10,
      paddingBottom: 10,
      fontSize: 15,
      color: theme.textPrimary,
      backgroundColor: theme.inputBg,
    },
    sendBtn: {
      marginLeft: 8,
      backgroundColor: theme.primary,
      borderRadius: 20,
      paddingHorizontal: 18,
      height: 40,
      justifyContent: 'center',
    },
    sendBtnDisabled: { backgroundColor: '#9db9f0' },
    stopBtn: { backgroundColor: theme.danger },
    sendText: { color: '#fff', fontWeight: '600' },
    modalBackdrop: {
      flex: 1,
      backgroundColor: theme.overlay,
      justifyContent: 'center',
      padding: 24,
    },
    modalSheet: {
      backgroundColor: theme.background,
      borderRadius: 14,
      paddingVertical: 8,
      maxHeight: '70%',
    },
    modalTitle: {
      fontSize: 13,
      color: theme.textTertiary,
      paddingHorizontal: 16,
      paddingVertical: 8,
    },
    modalList: { paddingHorizontal: 4 },
    groupLabel: {
      fontSize: 12,
      fontWeight: '600',
      color: theme.textSecondary,
      paddingHorizontal: 12,
      paddingTop: 10,
      paddingBottom: 2,
    },
    groupEmpty: { fontSize: 12, color: theme.textTertiary, paddingHorizontal: 12, paddingBottom: 4 },
    modelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 11,
      paddingHorizontal: 12,
    },
    modelName: { fontSize: 15, color: theme.textPrimary, flex: 1 },
    modelNameActive: { color: theme.primary, fontWeight: '600' },
    modelCheck: { fontSize: 16, color: theme.primary, marginLeft: 8 },
    modelManage: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.borderLight,
      paddingVertical: 12,
      alignItems: 'center',
    },
    modelManageText: { fontSize: 14, color: theme.primary },
    // 图片大图预览
    previewOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.92)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    previewClose: {
      position: 'absolute',
      top: 40,
      right: 20,
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: 'rgba(255,255,255,0.2)',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 2,
    },
    previewCloseText: { color: '#fff', fontSize: 20 },
    previewImage: { width: '100%', height: '80%' },
  });
}
