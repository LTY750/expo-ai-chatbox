// 聊天界面 —— 消息列表 + 输入框 + 流式显示
// 头部=当前对话名；输入框左侧=模型选择器（按服务商分组）
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  PanResponder,
  Platform as RNPlatform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useChatStore, type PendingAttachment } from '../store';
import type {
  Attachment,
  Message,
  MessageQuote,
  ReasoningEffort,
  ToolResult,
} from '../types';
import { useTheme, darkTheme, type ThemeColors } from '../theme';
import Markdown from 'react-native-markdown-display';
import { MathView } from './MathView';
import { MermaidView } from './MermaidView';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import { getProviderKey } from '../settings';
import { AppIcon } from './AppIcon';
import { BottomSheetModal } from './BottomSheetModal';
import { MotionPressable } from './MotionPressable';
import { MOTION_DURATION, MOTION_EASING } from './motion';
import ConversationSettingsModal from './ConversationSettingsModal';
import {
  DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS,
  estimateTokenCount,
  modelContextKey,
  prepareContext,
} from '../context';

const REASONING_OPTIONS: Array<{
  value: ReasoningEffort;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  { value: 'auto', label: '自动', shortLabel: '自动', description: '不额外指定，由当前模型决定' },
  { value: 'low', label: '低', shortLabel: '低', description: '更快响应，适合简单问题' },
  { value: 'medium', label: '中', shortLabel: '中', description: '平衡响应速度与推理质量' },
  { value: 'high', label: '高', shortLabel: '高', description: '更充分推理，可能消耗更多时间和 tokens' },
];

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
  const globalSystemPrompt = useChatStore((s) => s.settings.systemPrompt);
  const maxOutputTokens = useChatStore((s) => s.settings.maxTokens);
  const modelContextWindows = useChatStore((s) => s.settings.modelContextWindows);
  const selectModel = useChatStore((s) => s.selectModel);
  const sessions = useChatStore((s) => s.sessions);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const parseAttachment = useChatStore((s) => s.parseAttachment);
  const deleteMessage = useChatStore((s) => s.deleteMessage);
  const regenerate = useChatStore((s) => s.regenerate);
  const editAndResend = useChatStore((s) => s.editAndResend);
  const insertTopicBoundary = useChatStore((s) => s.insertTopicBoundary);
  const updateConversationSettings = useChatStore((s) => s.updateConversationSettings);
  const newSession = useChatStore((s) => s.newSession);
  const webSearchEnabled = useChatStore((s) => s.webSearchEnabled);
  const searching = useChatStore((s) => s.searching);
  const tavilyReady = useChatStore((s) => s.tavilyReady);
  const toggleWebSearch = useChatStore((s) => s.toggleWebSearch);

  const currentSession = sessions.find((x) => x.id === currentSessionId) ?? null;
  const title = currentSession?.title ?? 'Chatbox';
  const reasoningEffort = currentSession?.settingsOverride?.reasoningEffort ?? 'auto';
  const reasoningOption = REASONING_OPTIONS.find((option) => option.value === reasoningEffort)
    ?? REASONING_OPTIONS[0];

  const [input, setInput] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(
    () => new Set(currentProviderId ? [currentProviderId] : [])
  );
  const [attachMenu, setAttachMenu] = useState(false);
  const [conversationMenu, setConversationMenu] = useState(false);
  const [conversationSettingsOpen, setConversationSettingsOpen] = useState(false);
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [pendingQuote, setPendingQuote] = useState<MessageQuote | null>(null);
  // 消息长按操作菜单 + 编辑弹窗
  const [actionMsg, setActionMsg] = useState<Message | null>(null);
  const [editMsg, setEditMsg] = useState<Message | null>(null);
  const [editText, setEditText] = useState('');
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewAttachment, setPreviewAttachment] = useState<Attachment | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [configuredProviderIds, setConfiguredProviderIds] = useState<Set<string>>(
    () => new Set()
  );
  const [providerKeysLoaded, setProviderKeysLoaded] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const copyFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openSettingsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 注册图片预览回调（供 MarkdownImage 调用）
  useEffect(() => {
    _onPreviewImage = (uri: string) => setPreviewImage(uri);
    return () => { _onPreviewImage = null; };
  }, []);

  useEffect(() => () => {
    if (copyFeedbackTimerRef.current) clearTimeout(copyFeedbackTimerRef.current);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    if (openSettingsTimerRef.current) clearTimeout(openSettingsTimerRef.current);
  }, []);

  useEffect(() => {
    setPendingQuote(null);
  }, [currentSessionId]);

  useEffect(() => {
    let cancelled = false;
    setProviderKeysLoaded(false);

    Promise.all(
      providers.map(async (provider) => {
        try {
          const key = await getProviderKey(provider.id);
          return key?.trim() ? provider.id : null;
        } catch {
          return null;
        }
      })
    ).then((ids) => {
      if (cancelled) return;
      setConfiguredProviderIds(new Set(ids.filter((id): id is string => !!id)));
      setProviderKeysLoaded(true);
    });

    return () => {
      cancelled = true;
    };
  }, [providers]);

  const selectableProviders = useMemo(
    () => providers.filter(
      (provider) => configuredProviderIds.has(provider.id) && provider.models.length > 0
    ),
    [configuredProviderIds, providers]
  );
  const currentModelSelectable = selectableProviders.some(
    (provider) =>
      provider.id === currentProviderId && provider.models.includes(currentModel)
  );
  const listRef = useRef<FlatList<Message>>(null);
  const nearBottomRef = useRef(true);
  const edgeTranslateY = useRef(new Animated.Value(0)).current;
  const topEdgeOpacity = useRef(new Animated.Value(0)).current;
  const bottomEdgeOpacity = useRef(new Animated.Value(0)).current;
  const topShadowOpacity = useRef(new Animated.Value(0)).current;
  const scrollOffsetRef = useRef(0);
  const viewportHeightRef = useRef(0);
  const contentHeightRef = useRef(0);
  const scrollDirectionRef = useRef<'top' | 'bottom' | null>(null);
  const messageCountRef = useRef(messages.length);
  const previousMessageCountRef = useRef(messages.length);
  const allMessagesVisibleRef = useRef(messages.length === 0);
  const lastEdgeFeedbackRef = useRef({ edge: null as 'top' | 'bottom' | null, time: 0 });
  messageCountRef.current = messages.length;
  if (previousMessageCountRef.current !== messages.length) {
    previousMessageCountRef.current = messages.length;
    allMessagesVisibleRef.current = messages.length === 0;
  }
  const handleViewableItemsChanged = useRef(({
    viewableItems,
  }: {
    viewableItems: Array<{ isViewable: boolean }>;
  }) => {
    const messageCount = messageCountRef.current;
    allMessagesVisibleRef.current = messageCount === 0
      || viewableItems.filter((item) => item.isViewable).length >= messageCount;
  }).current;
  const edgePanResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponderCapture: () => {
      scrollDirectionRef.current = null;
      return false;
    },
    onMoveShouldSetPanResponderCapture: (_event, gestureState) => {
      if (Math.abs(gestureState.dy) < 12) return false;
      if (allMessagesVisibleRef.current) {
        triggerEdgeFeedback(gestureState.dy > 0 ? 'top' : 'bottom');
        return false;
      }
      const maxOffset = Math.max(0, contentHeightRef.current - viewportHeightRef.current);
      const offset = Math.max(0, Math.min(scrollOffsetRef.current, maxOffset));
      const atTop = offset <= 1;
      const atBottom = maxOffset - offset <= 1;

      if (atTop && atBottom) {
        triggerEdgeFeedback(gestureState.dy > 0 ? 'top' : 'bottom');
      } else if (atTop && gestureState.dy > 0) {
        triggerEdgeFeedback('top');
      } else if (atBottom && gestureState.dy < 0) {
        triggerEdgeFeedback('bottom');
      }
      return false;
    },
  })).current;

  useEffect(() => () => {
    edgeTranslateY.stopAnimation();
    topEdgeOpacity.stopAnimation();
    bottomEdgeOpacity.stopAnimation();
    topShadowOpacity.stopAnimation();
  }, [bottomEdgeOpacity, edgeTranslateY, topEdgeOpacity, topShadowOpacity]);

  const effectiveSystemPrompt = currentSession?.settingsOverride?.systemPrompt
    ?? globalSystemPrompt;
  const contextWindowTokens = modelContextWindows[
    modelContextKey(currentProviderId, currentModel)
  ] ?? DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS;
  const contextInfo = useMemo(
    () => prepareContext(
      messages,
      effectiveSystemPrompt,
      {
        autoCompress: !!currentSession?.conversationSettings?.autoCompressContext,
        contextWindowTokens,
        reservedOutputTokens: maxOutputTokens,
      }
    ),
    [
      messages,
      effectiveSystemPrompt,
      currentSession?.conversationSettings?.autoCompressContext,
      contextWindowTokens,
      maxOutputTokens,
    ]
  );
  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    if (!query) return [];
    return messages.filter((message) =>
      !message.topicBoundary && searchableMessageText(message).toLocaleLowerCase().includes(query)
    );
  }, [messages, searchQuery]);

  function triggerEdgeFeedback(edge: 'top' | 'bottom') {
    const now = Date.now();
    if (
      lastEdgeFeedbackRef.current.edge === edge
      && now - lastEdgeFeedbackRef.current.time < 320
    ) return;
    lastEdgeFeedbackRef.current = { edge, time: now };

    edgeTranslateY.stopAnimation();
    topEdgeOpacity.stopAnimation();
    bottomEdgeOpacity.stopAnimation();
    edgeTranslateY.setValue(edge === 'top' ? 4 : -4);
    topEdgeOpacity.setValue(0);
    bottomEdgeOpacity.setValue(0);

    const opacity = edge === 'top' ? topEdgeOpacity : bottomEdgeOpacity;

    Animated.parallel([
      Animated.spring(edgeTranslateY, {
        toValue: 0,
        stiffness: 260,
        damping: 18,
        mass: 0.42,
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.24,
          duration: 90,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 280,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }

  function handleScrollSettled(
    contentOffsetY: number,
    viewportHeight: number,
    contentHeight: number
  ) {
    const maxOffset = Math.max(0, contentHeight - viewportHeight);
    const offset = Math.max(0, Math.min(contentOffsetY, maxOffset));
    const atTop = offset <= 1;
    const atBottom = maxOffset - offset <= 1;
    const direction = scrollDirectionRef.current;

    if (atTop && atBottom) {
      if (direction) triggerEdgeFeedback(direction);
    } else if (atTop && direction === 'top') {
      triggerEdgeFeedback('top');
    } else if (atBottom && direction === 'bottom') {
      triggerEdgeFeedback('bottom');
    }
  }

  useEffect(() => {
    if (pickerOpen && currentProviderId) {
      setExpandedProviders((current) => new Set([...current, currentProviderId]));
    }
  }, [pickerOpen, currentProviderId]);

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
  async function runParse(file: {
    uri: string;
    name: string;
    mimeType?: string;
    size?: number;
  }) {
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
      if (result.status === 'error') {
        setErr(result.error ?? '文件解析失败');
      }
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setErr(msg);
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
    const mimeTypes = [
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
    ];

    const res = await DocumentPicker.getDocumentAsync({
      type: mimeTypes,
      // Expo Go 56 会把 Android 缓存副本放到宿主缓存目录，FileSystem 随后
      // 会因项目级路径权限拒绝读取。Android 保留系统授予权限的 content://
      // URI 并立即用新版 File API 读取；其他平台仍按 Expo 文档复制到缓存。
      copyToCacheDirectory: RNPlatform.OS !== 'android',
    });
    if (res.canceled || !res.assets?.length) return;
    const a = res.assets[0];
    runParse({ uri: a.uri, name: a.name ?? '文件', mimeType: a.mimeType, size: a.size });
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
    runParse({
      uri: a.uri,
      name,
      mimeType: a.mimeType ?? 'image/jpeg',
      size: a.fileSize,
    });
  }

  function removePending(id: string) {
    setPending((p) => p.filter((a) => a.id !== id));
  }

  function toggleProvider(providerId: string) {
    setExpandedProviders((current) => {
      const next = new Set(current);
      next.has(providerId) ? next.delete(providerId) : next.add(providerId);
      return next;
    });
  }

  async function ensureConversation(): Promise<string> {
    return currentSessionId ?? newSession();
  }

  async function handleInsertTopic() {
    setConversationMenu(false);
    try {
      await insertTopicBoundary();
      setPendingQuote(null);
      nearBottomRef.current = true;
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    } catch (error: any) {
      setErr(error?.message ?? String(error));
    }
  }

  async function openConversationSettings() {
    setConversationMenu(false);
    try {
      await ensureConversation();
      setConversationSettingsOpen(true);
    } catch (error: any) {
      setErr(error?.message ?? String(error));
    }
  }

  async function setAutoCompress(enabled: boolean) {
    try {
      const sessionId = await ensureConversation();
      await updateConversationSettings(sessionId, {}, { autoCompressContext: enabled });
    } catch (error: any) {
      setErr(error?.message ?? String(error));
    }
  }

  async function selectReasoningEffort(value: ReasoningEffort) {
    try {
      const sessionId = await ensureConversation();
      await updateConversationSettings(sessionId, { reasoningEffort: value }, {});
      setReasoningOpen(false);
    } catch (error: any) {
      setErr(error?.message ?? String(error));
    }
  }

  function openSearchResult(message: Message) {
    const index = messages.findIndex((item) => item.id === message.id);
    if (index < 0) return;
    setSearchOpen(false);
    setHighlightedMessageId(message.id);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setHighlightedMessageId(null), 2200);
    setTimeout(() => {
      listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.35 });
    }, 220);
  }

  async function handleSend() {
    const text = input.trim();
    const ready = pending.filter((a) => a.status === 'done');
    if ((!text && !ready.length) || isStreaming || parsing) return;
    setInput('');
    setErr(null);
    nearBottomRef.current = true;
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    const toSend = ready;
    const quoteToSend = pendingQuote ?? undefined;
    setPending([]);
    setPendingQuote(null);
    try {
      await sendMessage(text, toSend, quoteToSend);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    }
  }

  async function copyMsg(m: Message) {
    if (!m.content) return;
    try {
      await Clipboard.setStringAsync(m.content);
      setCopiedMessageId(m.id);
      if (copyFeedbackTimerRef.current) clearTimeout(copyFeedbackTimerRef.current);
      copyFeedbackTimerRef.current = setTimeout(() => setCopiedMessageId(null), 3000);
      setActionMsg(null);
    } catch (error: any) {
      setErr(error?.message ?? '复制失败');
    }
  }
  function quoteMsg(m: Message) {
    const content = m.content.trim();
    if (!content) return;
    setPendingQuote({
      messageId: m.id,
      role: m.role,
      preview: makeQuotePreview(content),
      content,
    });
    setActionMsg(null);
    nearBottomRef.current = true;
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      listRef.current?.scrollToEnd({ animated: true });
    });
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
      nearBottomRef.current = true;
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }));
      try {
        await editAndResend(m.id, editText);
      } catch (e: any) {
        setErr(e?.message ?? String(e));
      }
    }
  }
  async function doRegenerate(m: Message) {
    setActionMsg(null);
    nearBottomRef.current = true;
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }));
    try {
      await regenerate(m.id);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    }
  }
  async function doDelete(m: Message) {
    setActionMsg(null);
    try {
      await deleteMessage(m.id);
    } catch (error: any) {
      setErr(error?.message ?? '删除失败');
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={RNPlatform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.header}>
        <View style={styles.headerActions}>
          <MotionPressable
            onPress={onOpenDrawer}
            hitSlop={8}
            style={styles.headerSide}
            accessibilityLabel="打开会话列表"
          >
            <AppIcon name="menu" size={25} color={theme.textPrimary} />
          </MotionPressable>
          <View style={styles.headerSide} />
        </View>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.headerActions}>
          <MotionPressable
            onPress={() => setSearchOpen(true)}
            hitSlop={7}
            style={styles.headerSide}
            accessibilityLabel="搜索当前对话"
          >
            <AppIcon name="search" size={22} color={theme.textPrimary} />
          </MotionPressable>
          <MotionPressable
            onPress={() => setConversationMenu(true)}
            hitSlop={7}
            style={styles.headerSide}
            accessibilityLabel="对话功能"
          >
            <AppIcon name="more" size={18} color={theme.textPrimary} />
          </MotionPressable>
        </View>
      </View>

      {!keyReady && (
        <MotionPressable style={styles.banner} onPress={onOpenSettings} pressScale={0.98}>
          <Text style={styles.bannerText}>
            当前服务商还没配置 API Key，点这里去设置 →
          </Text>
        </MotionPressable>
      )}

      <View style={styles.messageArea}>
        {!!currentSession?.conversationSettings?.backgroundImageUri && (
          <>
            <Image
              source={{ uri: currentSession.conversationSettings.backgroundImageUri }}
              style={styles.backgroundImage}
              resizeMode="cover"
            />
            <View style={styles.backgroundVeil} pointerEvents="none" />
          </>
        )}
        <Animated.View
          style={[styles.flex, { transform: [{ translateY: edgeTranslateY }] }]}
          {...edgePanResponder.panHandlers}
        >
          <FlatList
            ref={listRef}
            style={styles.flex}
            contentContainerStyle={styles.listContent}
            data={messages}
            keyExtractor={(m) => m.id}
            onViewableItemsChanged={handleViewableItemsChanged}
            renderItem={({ item }) => (
              <MessageBubble
                msg={item}
                copied={copiedMessageId === item.id}
                highlighted={highlightedMessageId === item.id}
                userAvatarUri={currentSession?.conversationSettings?.userAvatarUri}
                assistantAvatarUri={currentSession?.conversationSettings?.assistantAvatarUri}
                actionsDisabled={isStreaming}
                onLongPress={() => setActionMsg(item)}
                onRegenerate={() => doRegenerate(item)}
                onCopy={() => copyMsg(item)}
                onQuote={() => quoteMsg(item)}
                onPreviewAttachment={setPreviewAttachment}
              />
            )}
            ListEmptyComponent={
              <Text style={styles.empty}>开始你的第一句对话吧</Text>
            }
            onLayout={(e) => {
              viewportHeightRef.current = e.nativeEvent.layout.height;
            }}
            onContentSizeChange={(_width, height) => {
              contentHeightRef.current = height;
              if (nearBottomRef.current) {
                requestAnimationFrame(() => {
                  listRef.current?.scrollToEnd({ animated: false });
                });
              }
            }}
            onScroll={(e) => {
              const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
              viewportHeightRef.current = layoutMeasurement.height;
              contentHeightRef.current = contentSize.height;
              const maxOffset = Math.max(0, contentSize.height - layoutMeasurement.height);
              const offset = Math.max(0, Math.min(contentOffset.y, maxOffset));
              const distanceFromBottom = maxOffset - offset;
              if (offset > scrollOffsetRef.current + 0.5) scrollDirectionRef.current = 'bottom';
              if (offset < scrollOffsetRef.current - 0.5) scrollDirectionRef.current = 'top';
              scrollOffsetRef.current = offset;
              nearBottomRef.current = distanceFromBottom < 100;
              topShadowOpacity.setValue(Math.min(1, offset / 18));
            }}
            onScrollEndDrag={(e) => {
              const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
              handleScrollSettled(
                contentOffset.y,
                layoutMeasurement.height,
                contentSize.height
              );
            }}
            onMomentumScrollEnd={(e) => {
              const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
              handleScrollSettled(contentOffset.y, layoutMeasurement.height, contentSize.height);
              scrollDirectionRef.current = null;
            }}
            onScrollToIndexFailed={(info) => {
              listRef.current?.scrollToOffset({
                offset: Math.max(0, info.averageItemLength * info.index),
                animated: true,
              });
            }}
            overScrollMode={RNPlatform.OS === 'android' ? 'never' : 'auto'}
            scrollEventThrottle={16}
          />
        </Animated.View>
        <Animated.View
          pointerEvents="none"
          style={[styles.topScrollShadow, { opacity: topShadowOpacity }]}
        >
          <View style={[styles.scrollShadowLine, { backgroundColor: theme.textPrimary }]} />
          <View style={[styles.scrollShadowSoft, { backgroundColor: theme.textPrimary }]} />
        </Animated.View>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.edgeFeedback,
            styles.edgeFeedbackTop,
            { backgroundColor: theme.primary, opacity: topEdgeOpacity },
          ]}
        />
        <Animated.View
          pointerEvents="none"
          style={[
            styles.edgeFeedback,
            styles.edgeFeedbackBottom,
            { backgroundColor: theme.primary, opacity: bottomEdgeOpacity },
          ]}
        />
      </View>

      {err && <Text style={styles.error}>{err}</Text>}

      <View style={styles.composerShell}>
        {pendingQuote && (
          <View style={styles.composerQuoteBar}>
            <View style={styles.composerQuoteAccent} />
            <Text style={styles.composerQuoteText} numberOfLines={1} ellipsizeMode="tail">
              {`引用 ${pendingQuote.role === 'assistant' ? 'AI' : '我'}：${pendingQuote.preview}`}
            </Text>
            <MotionPressable
              style={styles.composerQuoteClose}
              onPress={() => setPendingQuote(null)}
              hitSlop={8}
              accessibilityLabel="取消引用"
            >
              <AppIcon name="close" size={15} color={theme.textSecondary} />
            </MotionPressable>
          </View>
        )}
        {pending.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            style={styles.pendingScroll}
            contentContainerStyle={styles.pendingBar}
          >
            {pending.map((a) => {
              const sizeLabel = formatFileSize(a.size);
              const readyLabel = sizeLabel
                ? `${sizeLabel} · 已就绪`
                : `${a.chars ?? a.text.length} 字 · 已就绪`;
              return (
                <View
                  key={a.id}
                  style={[styles.pendingCard, a.status === 'error' && styles.pendingCardError]}
                >
                  <View style={styles.pendingIconWrap}>
                    <AppIcon
                      name={a.kind === 'image' ? 'image' : 'document'}
                      size={20}
                      color={a.status === 'error' ? theme.danger : theme.primary}
                    />
                  </View>
                  <View style={styles.pendingCopy}>
                    <Text style={styles.pendName} numberOfLines={1}>{a.name}</Text>
                    {a.status === 'parsing' ? (
                      <View style={styles.pendingStatusRow}>
                        <ActivityIndicator size="small" style={styles.pendSpin} color={theme.textSecondary} />
                        <Text style={styles.pendingStatus}>正在读取…</Text>
                      </View>
                    ) : a.status === 'error' ? (
                      <Text
                        style={[styles.pendingStatus, styles.pendingStatusStandalone, styles.pendErr]}
                        numberOfLines={1}
                      >
                        读取失败
                      </Text>
                    ) : (
                      <Text
                        style={[styles.pendingStatus, styles.pendingStatusStandalone]}
                        numberOfLines={1}
                      >
                        {readyLabel}
                      </Text>
                    )}
                  </View>
                  <MotionPressable
                    style={styles.pendCloseBtn}
                    onPress={() => removePending(a.id)}
                    hitSlop={8}
                    accessibilityLabel={`移除附件 ${a.name}`}
                  >
                    <AppIcon name="close" size={15} color={theme.textSecondary} />
                  </MotionPressable>
                </View>
              );
            })}
          </ScrollView>
        )}

        <View style={[
          styles.inputRow,
          (pending.length > 0 || pendingQuote) && styles.inputRowWithAttachments,
        ]}>
          <MotionPressable
            style={styles.attachBtn}
            onPress={() => setAttachMenu(true)}
            accessibilityLabel="添加附件"
          >
            <AppIcon name="attach" size={22} color={theme.textSecondary} />
          </MotionPressable>
          <TextInput
            ref={inputRef}
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="输入消息…"
            placeholderTextColor={theme.placeholder}
            multiline
            editable={!isStreaming}
          />
          {isStreaming ? (
          <MotionPressable
            key="stop"
            style={[styles.sendBtn, styles.stopBtn]}
            onPress={stopStreaming}
            accessibilityLabel="停止生成"
          >
            <AppIcon name="stop" size={15} color="#fff" />
          </MotionPressable>
          ) : (
            <MotionPressable
              key="send"
              style={[
                styles.sendBtn,
                (parsing || (!input.trim() && !pending.some((a) => a.status === 'done'))) &&
                  styles.sendBtnDisabled,
              ]}
              onPress={handleSend}
              disabled={parsing || (!input.trim() && !pending.some((a) => a.status === 'done'))}
              accessibilityLabel="发送消息"
            >
              <AppIcon name="send" size={23} color="#fff" />
            </MotionPressable>
          )}
        </View>
      </View>

      <View style={styles.toolBar}>
        <MotionPressable
          style={[styles.webBtn, webSearchEnabled && styles.webBtnActive, isStreaming && styles.webBtnDisabled]}
          onPress={toggleWebSearch}
          disabled={isStreaming}
        >
          <AppIcon
            name="search"
            size={16}
            color={webSearchEnabled ? theme.primary : theme.textSecondary}
            style={styles.webIcon}
          />
          <Text style={[styles.webText, webSearchEnabled && styles.webTextActive]}>
            联网搜索
          </Text>
        </MotionPressable>
        <MotionPressable
          style={[
            styles.reasoningBtn,
            reasoningEffort !== 'auto' && styles.reasoningBtnActive,
            isStreaming && styles.webBtnDisabled,
          ]}
          onPress={() => setReasoningOpen(true)}
          disabled={isStreaming}
          accessibilityLabel={`思考深度：${reasoningOption.label}`}
        >
          <AppIcon
            name="brain"
            size={14}
            color={reasoningEffort === 'auto' ? theme.textSecondary : theme.primary}
            style={styles.reasoningIcon}
          />
          <Text style={[
            styles.reasoningText,
            reasoningEffort !== 'auto' && styles.reasoningTextActive,
          ]}>
            {reasoningOption.shortLabel}
          </Text>
        </MotionPressable>
        {searching && (
          <View style={styles.searchingBar}>
            <ActivityIndicator size="small" color={theme.textSecondary} />
            <Text style={styles.searchingText}>搜索中</Text>
          </View>
        )}
        <View style={styles.toolSpacer} />
        <Text
          style={[styles.contextUsage, contextInfo.compressed && styles.contextUsageCompressed]}
          numberOfLines={1}
          accessibilityLabel={
            `当前上下文估算 ${contextInfo.effectiveTokens} tokens，模型窗口 ${contextWindowTokens} tokens`
          }
        >
          {`上下文 ≈${formatTokenAmount(contextInfo.effectiveTokens)}/${formatTokenAmount(contextWindowTokens)}`}
        </Text>
        <MotionPressable style={styles.modelBtn} onPress={() => setPickerOpen(true)}>
          <Text style={styles.modelBtnText} numberOfLines={1}>
            {providerKeysLoaded && currentModelSelectable
              ? shortModelName(currentModel)
              : providerKeysLoaded
                ? '选模型'
                : '加载中'}
          </Text>
          <AppIcon name="chevronDown" size={14} color={theme.textSecondary} />
        </MotionPressable>
      </View>
      {webSearchEnabled && !tavilyReady && (
        <MotionPressable style={styles.webWarn} onPress={onOpenSettings} pressScale={0.98}>
          <Text style={styles.webWarnText}>未配置 Tavily Key，点这里去设置 →</Text>
        </MotionPressable>
      )}

      <BottomSheetModal
        visible={attachMenu}
        onRequestClose={() => setAttachMenu(false)}
        sheetStyle={styles.menuSheet}
      >
        <MotionPressable style={styles.menuItem} onPress={pickDocument}>
          <AppIcon name="document" size={21} color={theme.primary} />
          <Text style={styles.menuText}>选择文件（txt / md / csv）</Text>
        </MotionPressable>
        <MotionPressable style={styles.menuItem} onPress={pickImage}>
          <AppIcon name="image" size={21} color={theme.primary} />
          <Text style={styles.menuText}>选择图片（OCR 识别）</Text>
        </MotionPressable>
      </BottomSheetModal>

      <BottomSheetModal
        visible={reasoningOpen}
        onRequestClose={() => setReasoningOpen(false)}
        sheetStyle={styles.reasoningSheet}
      >
        <View style={styles.reasoningHeader}>
          <View style={styles.reasoningHeaderIcon}>
            <AppIcon name="brain" size={18} color={theme.primary} />
          </View>
          <View style={styles.reasoningHeaderCopy}>
            <Text style={styles.reasoningTitle}>思考深度</Text>
            <Text style={styles.reasoningSubtitle}>支持范围由模型服务商决定，不支持时请选择自动</Text>
          </View>
        </View>
        {REASONING_OPTIONS.map((option) => {
          const active = option.value === reasoningEffort;
          return (
            <MotionPressable
              key={option.value}
              style={[styles.reasoningOption, active && styles.reasoningOptionActive]}
              onPress={() => selectReasoningEffort(option.value)}
              accessibilityLabel={`设置思考深度为${option.label}`}
            >
              <View style={styles.reasoningOptionCopy}>
                <Text style={[styles.reasoningOptionLabel, active && styles.reasoningOptionLabelActive]}>
                  {option.label}
                </Text>
                <Text style={styles.reasoningOptionDescription}>{option.description}</Text>
              </View>
              {active && <AppIcon name="check" size={20} color={theme.primary} />}
            </MotionPressable>
          );
        })}
      </BottomSheetModal>

      <BottomSheetModal
        visible={pickerOpen}
        onRequestClose={() => setPickerOpen(false)}
        sheetStyle={styles.modalSheet}
      >
        <Text style={styles.modalTitle}>选择模型</Text>
        <ScrollView style={styles.modalList}>
          {!providerKeysLoaded ? (
            <View style={styles.modelPickerState}>
              <ActivityIndicator size="small" color={theme.primary} />
              <Text style={styles.modelPickerStateTitle}>正在检查服务商配置…</Text>
            </View>
          ) : selectableProviders.length === 0 ? (
            <View style={styles.modelPickerState}>
              <View style={styles.modelPickerStateIcon}>
                <AppIcon name="model" size={22} color={theme.textSecondary} />
              </View>
              <Text style={styles.modelPickerStateTitle}>暂无可选择的模型</Text>
              <Text style={styles.modelPickerStateHint}>
                请先在设置中填写 API Key，并添加或获取至少一个模型
              </Text>
            </View>
          ) : selectableProviders.map((p) => (
            <View
              key={p.id}
              style={[
                styles.providerGroup,
                p.id === currentProviderId && styles.providerGroupActive,
              ]}
            >
              <MotionPressable
                style={styles.providerHeader}
                onPress={() => toggleProvider(p.id)}
                accessibilityLabel={`${expandedProviders.has(p.id) ? '折叠' : '展开'} ${p.name}`}
              >
                <View style={styles.providerMark}>
                  <AppIcon name="model" size={18} color={theme.primary} />
                </View>
                <View style={styles.providerCopy}>
                  <Text style={styles.groupLabel} numberOfLines={1}>{p.name}</Text>
                  <Text style={styles.providerMeta}>
                    {p.type === 'anthropic' ? 'Anthropic 原生' : 'OpenAI 兼容'} · {p.models.length} 个模型
                  </Text>
                </View>
                <View style={[
                  styles.protocolPill,
                  p.type === 'anthropic' && styles.protocolPillAnthropic,
                ]}>
                  <Text style={[
                    styles.protocolPillText,
                    p.type === 'anthropic' && styles.protocolPillTextAnthropic,
                  ]}>
                    {p.type === 'anthropic' ? 'A' : 'OAI'}
                  </Text>
                </View>
                <AppIcon
                  name={expandedProviders.has(p.id) ? 'collapse' : 'expand'}
                  size={16}
                  color={theme.textSecondary}
                />
              </MotionPressable>
              {expandedProviders.has(p.id) && (
                <View style={styles.providerModels}>
                  {p.models.map((m) => {
                    const active = m === currentModel && p.id === currentProviderId;
                    return (
                      <MotionPressable
                        key={p.id + m}
                        style={[styles.modelRow, active && styles.modelRowActive]}
                        onPress={() => {
                          selectModel(p.id, m);
                          setPickerOpen(false);
                        }}
                      >
                        <Text style={[styles.modelName, active && styles.modelNameActive]}>
                          {m}
                        </Text>
                        {active && <AppIcon name="check" size={18} color={theme.primary} />}
                      </MotionPressable>
                    );
                  })}
                </View>
              )}
            </View>
          ))}
        </ScrollView>
        <MotionPressable
          style={styles.modelManage}
          onPress={() => {
            setPickerOpen(false);
            if (openSettingsTimerRef.current) clearTimeout(openSettingsTimerRef.current);
            openSettingsTimerRef.current = setTimeout(onOpenSettings, MOTION_DURATION.exit);
          }}
        >
          <View style={styles.menuItemInline}>
            <AppIcon name="settings" size={18} color={theme.primary} />
            <Text style={styles.modelManageText}>管理服务商和模型</Text>
          </View>
        </MotionPressable>
      </BottomSheetModal>

      <BottomSheetModal
        visible={conversationMenu}
        onRequestClose={() => setConversationMenu(false)}
        sheetStyle={styles.menuSheet}
      >
        <Text style={styles.conversationMenuTitle}>当前对话</Text>
        <MotionPressable
          style={[styles.menuItem, isStreaming && styles.answerActionDisabled]}
          onPress={handleInsertTopic}
          disabled={isStreaming}
        >
          <AppIcon name="add" size={21} color={theme.primary} />
          <View style={styles.menuItemCopy}>
            <Text style={styles.menuText}>插入新话题</Text>
            <Text style={styles.menuHint}>留在当前对话，只从这里开始新的模型上下文</Text>
          </View>
        </MotionPressable>
        <MotionPressable style={styles.menuItem} onPress={openConversationSettings}>
          <AppIcon name="settings" size={20} color={theme.primary} />
          <View style={styles.menuItemCopy}>
            <Text style={styles.menuText}>对话设置</Text>
            <Text style={styles.menuHint}>头像、参数、背景图片和系统提示词</Text>
          </View>
          <AppIcon name="chevronRight" size={18} color={theme.textTertiary} />
        </MotionPressable>
        <View style={styles.menuItem}>
          <AppIcon name="generation" size={20} color={theme.primary} />
          <View style={styles.menuItemCopy}>
            <Text style={styles.menuText}>自动压缩上下文</Text>
            <Text style={styles.menuHint}>
              {contextInfo.compressed ? '当前已压缩，完整聊天记录不会删除' : '超过约 12k tokens 时自动压缩旧内容'}
            </Text>
          </View>
          <Switch
            value={!!currentSession?.conversationSettings?.autoCompressContext}
            onValueChange={setAutoCompress}
            trackColor={{ false: theme.border, true: theme.primary }}
            disabled={isStreaming}
          />
        </View>
      </BottomSheetModal>

      <Modal
        visible={searchOpen}
        animationType="slide"
        onRequestClose={() => setSearchOpen(false)}
      >
        <View style={[styles.searchScreen, { backgroundColor: theme.background }]}>
          <View style={styles.searchHeader}>
            <MotionPressable
              style={styles.searchBack}
              onPress={() => setSearchOpen(false)}
              accessibilityLabel="关闭对话搜索"
            >
              <AppIcon name="back" size={26} color={theme.primary} />
            </MotionPressable>
            <View style={styles.searchInputWrap}>
              <AppIcon name="search" size={18} color={theme.textTertiary} />
              <TextInput
                style={styles.searchInput}
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="搜索当前对话"
                placeholderTextColor={theme.placeholder}
                autoFocus
                returnKeyType="search"
              />
              {!!searchQuery && (
                <MotionPressable onPress={() => setSearchQuery('')} hitSlop={8}>
                  <AppIcon name="close" size={18} color={theme.textTertiary} />
                </MotionPressable>
              )}
            </View>
          </View>
          <Text style={styles.searchCount}>
            {searchQuery.trim() ? `找到 ${searchResults.length} 条结果` : '输入关键词搜索消息和附件解析内容'}
          </Text>
          <FlatList
            data={searchResults}
            keyExtractor={(message) => message.id}
            contentContainerStyle={styles.searchResults}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <MotionPressable style={styles.searchResult} onPress={() => openSearchResult(item)}>
                <View style={styles.searchResultHeader}>
                  <Text style={styles.searchResultRole}>
                    {item.role === 'user' ? '我' : 'AI 助手'}
                  </Text>
                  <Text style={styles.searchResultTime}>{formatMessageTime(item.createdAt)}</Text>
                </View>
                <Text style={styles.searchResultText} numberOfLines={3}>
                  {searchableMessageText(item)}
                </Text>
              </MotionPressable>
            )}
            ListEmptyComponent={
              searchQuery.trim() ? <Text style={styles.searchEmpty}>没有找到匹配内容</Text> : null
            }
          />
        </View>
      </Modal>

      <ConversationSettingsModal
        visible={conversationSettingsOpen}
        session={currentSession}
        onClose={() => setConversationSettingsOpen(false)}
        onError={setErr}
      />

      <BottomSheetModal
        visible={!!actionMsg}
        onRequestClose={() => setActionMsg(null)}
        sheetStyle={styles.menuSheet}
      >
        <MotionPressable style={styles.menuItem} onPress={() => actionMsg && copyMsg(actionMsg)}>
          <AppIcon name="copy" size={20} color={theme.textPrimary} />
          <Text style={styles.menuText}>复制</Text>
        </MotionPressable>
        {actionMsg?.role === 'user' && (
          <MotionPressable style={styles.menuItem} onPress={() => actionMsg && startEdit(actionMsg)}>
            <AppIcon name="edit" size={20} color={theme.textPrimary} />
            <Text style={styles.menuText}>编辑并重发</Text>
          </MotionPressable>
        )}
        {actionMsg?.role === 'assistant' && actionMsg.status !== 'streaming' && (
          <MotionPressable style={styles.menuItem} onPress={() => actionMsg && doRegenerate(actionMsg)}>
            <AppIcon name="retry" size={20} color={theme.textPrimary} />
            <Text style={styles.menuText}>重新生成</Text>
          </MotionPressable>
        )}
        <MotionPressable style={styles.menuItem} onPress={() => actionMsg && doDelete(actionMsg)}>
          <AppIcon name="delete" size={20} color={theme.danger} />
          <Text style={[styles.menuText, styles.menuDanger]}>删除</Text>
        </MotionPressable>
      </BottomSheetModal>

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
              <MotionPressable style={styles.editCancel} onPress={() => setEditMsg(null)}>
                <Text style={styles.editCancelText}>取消</Text>
              </MotionPressable>
              <MotionPressable style={styles.editOk} onPress={commitEdit}>
                <View style={styles.menuItemInline}>
                  <AppIcon name="send" size={17} color="#fff" />
                  <Text style={styles.editOkText}>重发</Text>
                </View>
              </MotionPressable>
            </View>
          </View>
        </View>
      </Modal>

      <AttachmentPreviewModal
        attachment={previewAttachment}
        onClose={() => setPreviewAttachment(null)}
      />

      {/* 图片大图预览 */}
      <Modal visible={!!previewImage} transparent animationType="fade" onRequestClose={() => setPreviewImage(null)}>
        <View style={styles.previewOverlay}>
          <MotionPressable style={styles.previewClose} onPress={() => setPreviewImage(null)}>
            <AppIcon name="close" size={23} color="#fff" />
          </MotionPressable>
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

function formatTokenAmount(tokens: number): string {
  if (tokens < 1000) return `${tokens}`;
  return `${(tokens / 1000).toFixed(tokens < 10_000 ? 1 : 0)}k`;
}

function formatMessageTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatFileSize(size?: number): string | null {
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return null;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

const QUOTE_PREVIEW_LIMIT = 72;

function makeQuotePreview(content: string): string {
  const compact = content
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[>*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (compact.length <= QUOTE_PREVIEW_LIMIT) return compact;
  return `${compact.slice(0, QUOTE_PREVIEW_LIMIT).trimEnd()}…`;
}

function searchableMessageText(message: Message): string {
  return [
    message.content,
    ...(message.attachments?.map((attachment) =>
      `${attachment.name}\n${attachment.parsedText ?? ''}`
    ) ?? []),
    ...(message.toolResults?.map((result) => result.content) ?? []),
  ].filter(Boolean).join('\n\n');
}

function MessageBubble({
  msg,
  copied,
  highlighted,
  userAvatarUri,
  assistantAvatarUri,
  actionsDisabled,
  onLongPress,
  onRegenerate,
  onCopy,
  onQuote,
  onPreviewAttachment,
}: {
  msg: Message;
  copied: boolean;
  highlighted: boolean;
  userAvatarUri?: string;
  assistantAvatarUri?: string;
  actionsDisabled: boolean;
  onLongPress: () => void;
  onRegenerate: () => void;
  onCopy: () => void;
  onQuote: () => void;
  onPreviewAttachment: (attachment: Attachment) => void;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const mdStyles = useMemo(() => createMdStyles(theme), [theme]);
  const mdRules = useMemo(() => createMdRules(theme), [theme]);
  const appear = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(appear, {
      toValue: 1,
      duration: MOTION_DURATION.enter,
      easing: MOTION_EASING.enter,
      useNativeDriver: true,
    }).start();
    return () => appear.stopAnimation();
  }, [appear]);

  const isUser = msg.role === 'user';
  const isAssistant = msg.role === 'assistant';
  const streaming = msg.status === 'streaming';
  const tokenCount = useMemo(() => estimateTokenCount(msg.content), [msg.content]);
  const showActions = isAssistant && !streaming && !!msg.content;
  if (msg.topicBoundary) {
    return <TopicBoundary createdAt={msg.createdAt} />;
  }
  return (
    <View
      style={[
        styles.bubbleRow,
        isUser ? styles.rowRight : styles.rowLeft,
      ]}
    >
      {!isUser && (
        <View style={styles.assistantAvatarSlot}>
          <MessageAvatar uri={assistantAvatarUri} fallback="AI" />
        </View>
      )}
      <Animated.View
        style={[
          styles.messageColumn,
          isUser ? styles.messageColumnRight : styles.messageColumnLeft,
          {
            opacity: appear,
            transform: [
              {
                translateY: appear.interpolate({
                  inputRange: [0, 1],
                  outputRange: [6, 0],
                }),
              },
            ],
          },
        ]}
      >
        <Pressable
          style={[
            styles.bubble,
            isUser ? styles.userBubble : styles.aiBubble,
            highlighted && styles.bubbleHighlighted,
          ]}
          onLongPress={onLongPress}
          delayLongPress={350}
        >
          {msg.quote && (
            <View style={styles.messageQuoteBar}>
              <View style={styles.messageQuoteAccent} />
              <Text style={styles.messageQuoteText} numberOfLines={1} ellipsizeMode="tail">
                {`引用 ${msg.quote.role === 'assistant' ? 'AI' : '我'}：${msg.quote.preview}`}
              </Text>
            </View>
          )}
          {msg.attachments?.map((attachment) => (
            <AttachmentPanel
              key={attachment.id}
              attachment={attachment}
              onPreview={() => onPreviewAttachment(attachment)}
            />
          ))}
          {!!msg.attachments?.length && !msg.attachmentContext && (
            <Text style={styles.bubbleErr}>⚠ 旧附件正文未保存，请重新上传</Text>
          )}
          {msg.toolResults?.map((result) => (
            <ToolResultPanel key={result.id} result={result} />
          ))}
          {msg.content ? (
            isUser ? (
              <Text style={[styles.bubbleText, styles.userText]}>{msg.content}</Text>
            ) : (
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
        {showActions && (
          <View style={styles.answerActions}>
            <Text style={styles.tokenCount}>≈{tokenCount} tokens</Text>
            <MotionPressable
              style={[styles.answerAction, actionsDisabled && styles.answerActionDisabled]}
              onPress={onRegenerate}
              disabled={actionsDisabled}
              accessibilityLabel="重新生成回答"
              accessibilityRole="button"
              hitSlop={6}
            >
              <AppIcon name="retry" size={16} color={theme.textSecondary} />
            </MotionPressable>
            <MotionPressable
              style={[styles.answerAction, actionsDisabled && styles.answerActionDisabled]}
              onPress={onCopy}
              disabled={actionsDisabled}
              accessibilityLabel={copied ? '已复制回答' : '复制回答'}
              accessibilityRole="button"
              hitSlop={6}
            >
              <AppIcon
                name={copied ? 'check' : 'copy'}
                size={16}
                color={copied ? theme.primary : theme.textSecondary}
              />
            </MotionPressable>
            <MotionPressable
              style={[styles.answerAction, actionsDisabled && styles.answerActionDisabled]}
              onPress={onQuote}
              disabled={actionsDisabled}
              accessibilityLabel="引用回答"
              accessibilityRole="button"
              hitSlop={6}
            >
              <AppIcon name="quote" size={16} color={theme.textSecondary} />
            </MotionPressable>
          </View>
        )}
      </Animated.View>
      {isUser && <MessageAvatar uri={userAvatarUri} fallback="我" />}
    </View>
  );
}

function MessageAvatar({ uri, fallback }: { uri?: string; fallback: string }) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return uri ? (
    <Image source={{ uri }} style={styles.messageAvatar} />
  ) : (
    <View style={styles.messageAvatarFallback}>
      <Text style={styles.messageAvatarText}>{fallback}</Text>
    </View>
  );
}

function TopicBoundary({ createdAt }: { createdAt: number }) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={styles.topicBoundary}>
      <View style={styles.topicLine} />
      <View style={styles.topicLabel}>
        <AppIcon name="add" size={14} color={theme.primary} />
        <Text style={styles.topicText}>新话题 · {formatMessageTime(createdAt)}</Text>
      </View>
      <View style={styles.topicLine} />
    </View>
  );
}

function AttachmentPanel({
  attachment,
  onPreview,
}: {
  attachment: Attachment;
  onPreview: () => void;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [copied, setCopied] = useState(false);
  const hasParsedText = !!attachment.parsedText?.trim();
  const details = [
    formatFileSize(attachment.size),
    hasParsedText ? `${attachment.chars ?? attachment.parsedText!.length} 字` : null,
    hasParsedText ? '点击预览' : '无可预览内容',
  ].filter(Boolean).join(' · ');

  async function copyParsedText() {
    if (!attachment.parsedText) return;
    await Clipboard.setStringAsync(attachment.parsedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <View style={styles.attachmentPanel}>
      <View style={styles.attachmentHeader}>
        <MotionPressable
          style={styles.attachmentToggle}
          onPress={onPreview}
          disabled={!hasParsedText}
          accessibilityRole="button"
          accessibilityLabel={`${attachment.name}，${hasParsedText ? '点击预览文件内容' : '没有可预览内容'}`}
        >
          <AppIcon
            name={attachment.kind === 'image' ? 'image' : 'document'}
            size={17}
            color={theme.textSecondary}
          />
          <View style={styles.attachmentCopy}>
            <Text style={styles.attName} numberOfLines={1}>{attachment.name}</Text>
            <Text style={styles.attachmentStatus} numberOfLines={1}>
              {details}
            </Text>
          </View>
          {hasParsedText && (
            <AppIcon name="chevronRight" size={16} color={theme.textSecondary} />
          )}
        </MotionPressable>
        {hasParsedText && (
          <MotionPressable style={styles.attachmentCopyButton} onPress={copyParsedText} hitSlop={7}>
            <AppIcon name={copied ? 'check' : 'copy'} size={15} color={theme.textSecondary} />
          </MotionPressable>
        )}
      </View>
    </View>
  );
}

function AttachmentPreviewModal({
  attachment,
  onClose,
}: {
  attachment: Attachment | null;
  onClose: () => void;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const mdStyles = useMemo(() => createMdStyles(theme), [theme]);
  const mdRules = useMemo(() => createMdRules(theme), [theme]);
  const [copied, setCopied] = useState(false);

  useEffect(() => setCopied(false), [attachment?.id]);

  async function copyPreview() {
    if (!attachment?.parsedText) return;
    await Clipboard.setStringAsync(attachment.parsedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  const details = attachment
    ? [
        formatFileSize(attachment.size),
        `${attachment.chars ?? attachment.parsedText?.length ?? 0} 字`,
        'Markdown 解析内容',
      ].filter(Boolean).join(' · ')
    : '';

  return (
    <Modal visible={!!attachment} animationType="slide" onRequestClose={onClose}>
      <View style={styles.attachmentPreviewScreen}>
        <View style={styles.attachmentPreviewHeader}>
          <MotionPressable
            style={styles.attachmentPreviewClose}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="关闭文件预览"
          >
            <AppIcon name="back" size={25} color={theme.primary} />
          </MotionPressable>
          <View style={styles.attachmentPreviewTitleWrap}>
            <Text style={styles.attachmentPreviewTitle} numberOfLines={1}>
              {attachment?.name ?? '文件预览'}
            </Text>
            <Text style={styles.attachmentPreviewMeta} numberOfLines={1}>{details}</Text>
          </View>
          <MotionPressable
            style={styles.attachmentPreviewCopy}
            onPress={copyPreview}
            accessibilityRole="button"
            accessibilityLabel={copied ? '已复制文件内容' : '复制文件内容'}
          >
            <AppIcon name={copied ? 'check' : 'copy'} size={19} color={theme.primary} />
          </MotionPressable>
        </View>
        <ScrollView
          style={styles.attachmentPreviewScroll}
          contentContainerStyle={styles.attachmentPreviewContent}
        >
          {attachment?.parsedText ? (
            <Markdown style={mdStyles} rules={mdRules}>
              {preprocessLatex(attachment.parsedText)}
            </Markdown>
          ) : (
            <Text style={styles.attachmentPreviewEmpty}>没有可预览的解析内容</Text>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function ToolResultPanel({ result }: { result: ToolResult }) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const isSearch = result.toolName === 'web_search';

  async function copyResult() {
    await Clipboard.setStringAsync(result.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <View style={styles.toolResultPanel}>
      <View style={styles.toolResultHeader}>
        <MotionPressable style={styles.toolResultToggle} onPress={() => setExpanded((value) => !value)}>
          <AppIcon name="search" size={17} color={theme.primary} />
          <View style={styles.toolResultCopy}>
            <Text style={styles.toolResultTitle} numberOfLines={1}>
              {isSearch ? `联网搜索：${result.query || '未命名查询'}` : result.toolName}
            </Text>
            <Text style={styles.toolResultMeta}>
              {result.sources?.length
                ? `搜索了 ${result.sources.length} 个网页 · ${expanded ? '点击收起' : '详情已折叠'}`
                : expanded ? '点击收起' : '返回内容已折叠'}
            </Text>
          </View>
          <AppIcon name={expanded ? 'collapse' : 'expand'} size={16} color={theme.textSecondary} />
        </MotionPressable>
        <MotionPressable style={styles.toolResultCopyButton} onPress={copyResult} hitSlop={7}>
          <AppIcon name={copied ? 'check' : 'copy'} size={15} color={theme.primary} />
        </MotionPressable>
      </View>
      {expanded && (
        <View style={styles.toolResultBody}>
          {result.sources?.map((source, index) => (
            <View key={`${source.url}-${index}`} style={styles.sourceCard}>
              <Text style={styles.sourceIndex}>网页 {index + 1}</Text>
              <Text
                style={styles.sourceTitle}
                onPress={() => Linking.openURL(source.url).catch(() => {})}
              >
                {source.title || source.url}
              </Text>
              <Text
                style={styles.sourceUrl}
                numberOfLines={2}
                onPress={() => Linking.openURL(source.url).catch(() => {})}
              >
                {source.url}
              </Text>
              <Text style={styles.sourceContent}>{source.content}</Text>
            </View>
          ))}
          <Text style={styles.toolRawLabel}>返回给模型的内容</Text>
          <Text selectable style={styles.toolRawText}>{result.content}</Text>
        </View>
      )}
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
        <MotionPressable onPress={copy} hitSlop={8} style={styles.codeAction}>
          <AppIcon name={copied ? 'check' : 'copy'} size={15} color="#7aa2f7" />
          <Text style={styles.codeCopy}>{copied ? '已复制' : '复制'}</Text>
        </MotionPressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Text style={styles.codeText}>{shown}</Text>
      </ScrollView>
      {collapsible && (
        <MotionPressable style={styles.codeToggle} onPress={() => setExpanded((v) => !v)}>
          <AppIcon
            name={expanded ? 'collapse' : 'expand'}
            size={16}
            color="#7aa2f7"
          />
          <Text style={styles.codeToggleText}>
            {expanded ? '收起' : `展开全部（${lines.length} 行）`}
          </Text>
        </MotionPressable>
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
    code_inline: (
      node: any,
      _children: any,
      _parent: any,
      markdownStyles: any,
      inheritedStyles: any = {}
    ) => {
      const c: string = node.content ?? '';
      if (c.startsWith('m:')) {
        return <MathView key={node.key} tex={c.slice(2)} color={theme.textPrimary} />;
      }
      return (
        <Text key={node.key} style={[inheritedStyles, markdownStyles.code_inline]}>
          {c}
        </Text>
      );
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
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
      backgroundColor: theme.surface,
    },
    headerSide: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerActions: { flexDirection: 'row', alignItems: 'center' },
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
    messageArea: { flex: 1, overflow: 'hidden' },
    backgroundImage: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
    backgroundVeil: {
      position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
      backgroundColor: theme.background,
      opacity: 0.7,
    },
    topScrollShadow: {
      position: 'absolute',
      top: 0,
      right: 0,
      left: 0,
      height: 10,
      zIndex: 2,
    },
    scrollShadowLine: { height: StyleSheet.hairlineWidth, opacity: 0.14 },
    scrollShadowSoft: { height: 9, opacity: 0.035 },
    edgeFeedback: {
      position: 'absolute',
      right: 36,
      left: 36,
      height: 2,
      borderRadius: 999,
      zIndex: 4,
      elevation: 2,
    },
    edgeFeedbackTop: { top: 0 },
    edgeFeedbackBottom: { bottom: 0 },
    listContent: { padding: 12 },
    empty: { textAlign: 'center', color: theme.textTertiary, marginTop: 40 },
    bubbleRow: { marginVertical: 5, flexDirection: 'row', alignItems: 'flex-end', gap: 7 },
    rowLeft: { justifyContent: 'flex-start' },
    rowRight: { justifyContent: 'flex-end' },
    messageColumn: { maxWidth: '84%', flexShrink: 1 },
    messageColumnLeft: { alignItems: 'stretch', width: '84%' },
    messageColumnRight: { alignItems: 'flex-end' },
    assistantAvatarSlot: { alignSelf: 'flex-start', marginTop: 3 },
    messageAvatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: theme.surfaceVariant },
    messageAvatarFallback: {
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.primaryLight,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
    },
    messageAvatarText: { color: theme.primary, fontSize: 11, fontWeight: '700' },
    bubble: { maxWidth: '100%', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 },
    bubbleHighlighted: { borderWidth: 2, borderColor: theme.primary },
    userBubble: { backgroundColor: theme.surfaceVariant, borderBottomRightRadius: 5 },
    aiBubble: { backgroundColor: 'transparent', paddingHorizontal: 2, paddingVertical: 3 },
    topicBoundary: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginVertical: 16,
      paddingHorizontal: 4,
    },
    topicLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: theme.border },
    topicLabel: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      borderRadius: 12,
      paddingHorizontal: 9,
      paddingVertical: 4,
      backgroundColor: theme.primaryLight,
    },
    topicText: { color: theme.primary, fontSize: 11, fontWeight: '600' },
    bubbleText: { fontSize: 15, lineHeight: 21, color: theme.aiBubbleText },
    userText: { color: theme.textPrimary },
    messageQuoteBar: {
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 6,
      paddingHorizontal: 8,
      paddingVertical: 5,
      borderRadius: 7,
      backgroundColor: theme.background,
    },
    messageQuoteAccent: {
      width: 2,
      height: 16,
      marginRight: 7,
      borderRadius: 1,
      backgroundColor: theme.primary,
    },
    messageQuoteText: { flex: 1, minWidth: 0, color: theme.textSecondary, fontSize: 12 },
    bubbleErr: { color: theme.danger, fontSize: 12, marginTop: 4 },
    answerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 3,
      marginTop: 4,
      paddingHorizontal: 2,
      maxWidth: '100%',
    },
    tokenCount: {
      fontSize: 11,
      color: theme.textTertiary,
      marginRight: 3,
      fontVariant: ['tabular-nums'],
    },
    answerAction: {
      width: 32,
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 16,
    },
    answerActionDisabled: { opacity: 0.45 },
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
    codeAction: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    codeText: {
      color: theme.codeText,
      fontFamily: RNPlatform.OS === 'ios' ? 'Menlo' : 'monospace',
      fontSize: 13,
      lineHeight: 19,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    codeToggle: {
      flexDirection: 'row',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: '#3a3f4b',
      paddingVertical: 8,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 5,
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
    attIcon: { marginRight: 6 },
    attName: { flex: 1, color: theme.textPrimary, fontSize: 13 },
    attMeta: { color: theme.textTertiary, fontSize: 11, marginLeft: 6 },
    attachmentPanel: {
      width: 260,
      maxWidth: '100%',
      borderRadius: 10,
      marginBottom: 7,
      overflow: 'hidden',
      backgroundColor: theme.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
    },
    attachmentHeader: { flexDirection: 'row', alignItems: 'stretch' },
    attachmentToggle: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      paddingHorizontal: 9,
      paddingVertical: 8,
    },
    attachmentCopy: { flex: 1, minWidth: 0 },
    attachmentStatus: { color: theme.textTertiary, fontSize: 10, marginTop: 2 },
    attachmentCopyButton: {
      width: 35,
      alignItems: 'center',
      justifyContent: 'center',
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderLeftColor: theme.border,
    },
    attachmentPreviewScreen: { flex: 1, backgroundColor: theme.background },
    attachmentPreviewHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingTop: RNPlatform.OS === 'android' ? 14 : 50,
      paddingBottom: 10,
      paddingHorizontal: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
      backgroundColor: theme.surface,
    },
    attachmentPreviewClose: {
      width: 40,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    attachmentPreviewTitleWrap: { flex: 1, minWidth: 0, paddingHorizontal: 6 },
    attachmentPreviewTitle: { color: theme.textPrimary, fontSize: 16, fontWeight: '700' },
    attachmentPreviewMeta: { color: theme.textTertiary, fontSize: 11, marginTop: 2 },
    attachmentPreviewCopy: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.primaryLight,
    },
    attachmentPreviewScroll: { flex: 1 },
    attachmentPreviewContent: { padding: 18, paddingBottom: 40, flexGrow: 1 },
    attachmentPreviewEmpty: { color: theme.textTertiary, textAlign: 'center', marginTop: 60 },
    toolResultPanel: {
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 10,
      overflow: 'hidden',
      marginBottom: 8,
      backgroundColor: theme.background,
    },
    toolResultHeader: { flexDirection: 'row', alignItems: 'stretch' },
    toolResultToggle: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      paddingHorizontal: 9,
      paddingVertical: 8,
    },
    toolResultCopy: { flex: 1, minWidth: 0 },
    toolResultTitle: { color: theme.textPrimary, fontSize: 12, fontWeight: '700' },
    toolResultMeta: { color: theme.textTertiary, fontSize: 10, marginTop: 2 },
    toolResultCopyButton: {
      width: 35,
      alignItems: 'center',
      justifyContent: 'center',
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderLeftColor: theme.border,
    },
    toolResultBody: {
      padding: 9,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.border,
      backgroundColor: theme.background,
    },
    sourceCard: {
      borderRadius: 8,
      padding: 9,
      marginBottom: 8,
      backgroundColor: theme.surfaceVariant,
    },
    sourceIndex: { color: theme.textTertiary, fontSize: 10, fontWeight: '600' },
    sourceTitle: { color: theme.primary, fontSize: 12, fontWeight: '700', marginTop: 3 },
    sourceUrl: { color: theme.textTertiary, fontSize: 10, marginTop: 2 },
    sourceContent: { color: theme.textPrimary, fontSize: 12, lineHeight: 18, marginTop: 6 },
    toolRawLabel: { color: theme.textSecondary, fontSize: 11, fontWeight: '700', marginBottom: 5 },
    toolRawText: {
      color: theme.textPrimary,
      fontSize: 11,
      lineHeight: 17,
      fontFamily: RNPlatform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    composerShell: {
      marginHorizontal: 10,
      marginTop: 6,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 22,
      overflow: 'hidden',
      backgroundColor: theme.surface,
      shadowColor: '#000',
      shadowOpacity: 0.05,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
      elevation: 1,
    },
    composerQuoteBar: {
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      paddingLeft: 12,
      paddingRight: 7,
      paddingTop: 9,
      paddingBottom: 7,
    },
    composerQuoteAccent: {
      width: 2,
      height: 18,
      marginRight: 8,
      borderRadius: 1,
      backgroundColor: theme.primary,
    },
    composerQuoteText: {
      flex: 1,
      minWidth: 0,
      color: theme.textSecondary,
      fontSize: 12,
    },
    composerQuoteClose: {
      width: 28,
      height: 28,
      flexShrink: 0,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 14,
    },
    pendingScroll: { maxHeight: 78 },
    pendingBar: {
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: 9,
      paddingTop: 9,
      paddingBottom: 5,
    },
    pendingCard: {
      width: 222,
      minHeight: 62,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      padding: 8,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      backgroundColor: theme.background,
    },
    pendingCardError: {
      borderColor: theme.danger,
      backgroundColor: theme.bannerBg,
    },
    pendingIconWrap: {
      width: 38,
      height: 38,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.primaryLight,
    },
    pendingCopy: { flex: 1, minWidth: 0 },
    pendName: { color: theme.textPrimary, fontSize: 13, fontWeight: '600' },
    pendingStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
    pendingStatus: { color: theme.textTertiary, fontSize: 10 },
    pendingStatusStandalone: { marginTop: 3 },
    pendSpin: { transform: [{ scale: 0.65 }] },
    pendErr: { color: theme.danger },
    pendCloseBtn: {
      width: 24,
      height: 24,
      flexShrink: 0,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'flex-start',
    },
    attachBtn: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'transparent',
    },
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
      position: 'relative',
      zIndex: 1,
      elevation: 2,
    },
    conversationMenuTitle: {
      color: theme.textTertiary,
      fontSize: 12,
      fontWeight: '600',
      paddingHorizontal: 22,
      paddingTop: 8,
      paddingBottom: 4,
    },
    menuItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 15,
      paddingHorizontal: 22,
    },
    menuItemCopy: { flex: 1 },
    menuHint: { color: theme.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 2 },
    menuItemInline: { flexDirection: 'row', alignItems: 'center', gap: 7 },
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
      paddingTop: 2,
      paddingBottom: 7,
      backgroundColor: theme.background,
    },
    toolSpacer: { flex: 1 },
    contextUsage: {
      color: theme.textTertiary,
      fontSize: 11,
      marginLeft: 6,
      fontVariant: ['tabular-nums'],
    },
    contextUsageCompressed: { color: theme.primary, fontWeight: '600' },
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
    webIcon: { marginRight: 4 },
    webText: { fontSize: 12, color: theme.textSecondary },
    webTextActive: { color: theme.primary, fontWeight: '600' },
    reasoningBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 30,
      marginLeft: 6,
      paddingHorizontal: 8,
      paddingVertical: 5,
      borderRadius: 15,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.background,
    },
    reasoningBtnActive: {
      borderColor: theme.primary,
      backgroundColor: theme.primaryLight,
    },
    reasoningIcon: { marginRight: 4 },
    reasoningText: { fontSize: 11, color: theme.textSecondary },
    reasoningTextActive: { color: theme.primary, fontWeight: '600' },
    reasoningSheet: {
      backgroundColor: theme.background,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      paddingHorizontal: 12,
      paddingTop: 14,
      paddingBottom: 24,
    },
    reasoningHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 8,
      paddingBottom: 12,
    },
    reasoningHeaderIcon: {
      width: 38,
      height: 38,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.primaryLight,
      marginRight: 10,
    },
    reasoningHeaderCopy: { flex: 1 },
    reasoningTitle: { color: theme.textPrimary, fontSize: 17, fontWeight: '700' },
    reasoningSubtitle: { color: theme.textTertiary, fontSize: 11, marginTop: 2 },
    reasoningOption: {
      minHeight: 62,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 14,
      paddingVertical: 9,
      borderRadius: 14,
      marginVertical: 2,
    },
    reasoningOptionActive: { backgroundColor: theme.primaryLight },
    reasoningOptionCopy: { flex: 1 },
    reasoningOptionLabel: { color: theme.textPrimary, fontSize: 15, fontWeight: '600' },
    reasoningOptionLabelActive: { color: theme.primary },
    reasoningOptionDescription: { color: theme.textTertiary, fontSize: 12, marginTop: 3 },
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
      padding: 5,
      backgroundColor: theme.surface,
    },
    inputRowWithAttachments: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.borderLight,
    },
    modelBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      maxWidth: 124,
      height: 34,
      paddingHorizontal: 9,
      marginLeft: 7,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 17,
      backgroundColor: theme.surfaceVariant,
    },
    modelBtnText: { fontSize: 12, color: theme.textPrimary, flexShrink: 1 },
    modelBtnCaret: { fontSize: 10, color: theme.textSecondary, marginLeft: 2 },
    input: {
      flex: 1,
      maxHeight: 120,
      minHeight: 40,
      borderWidth: 0,
      paddingHorizontal: 8,
      paddingTop: 10,
      paddingBottom: 10,
      fontSize: 15,
      color: theme.textPrimary,
      backgroundColor: 'transparent',
    },
    sendBtn: {
      marginLeft: 4,
      backgroundColor: theme.primary,
      borderRadius: 19,
      width: 38,
      height: 38,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sendBtnDisabled: { backgroundColor: theme.border },
    stopBtn: { backgroundColor: theme.danger },
    modalBackdrop: {
      flex: 1,
      backgroundColor: theme.overlay,
      justifyContent: 'flex-end',
    },
    modalSheet: {
      backgroundColor: theme.background,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      paddingTop: 10,
      paddingBottom: 18,
      maxHeight: '78%',
    },
    modalTitle: {
      fontSize: 13,
      color: theme.textTertiary,
      paddingHorizontal: 16,
      paddingVertical: 8,
    },
    modalList: { paddingHorizontal: 4 },
    modelPickerState: {
      minHeight: 150,
      paddingHorizontal: 28,
      paddingVertical: 28,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    modelPickerStateIcon: {
      width: 44,
      height: 44,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.surfaceVariant,
      marginBottom: 2,
    },
    modelPickerStateTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.textSecondary,
      textAlign: 'center',
    },
    modelPickerStateHint: {
      fontSize: 12,
      lineHeight: 18,
      color: theme.textTertiary,
      textAlign: 'center',
    },
    providerGroup: {
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 12,
      marginHorizontal: 7,
      marginBottom: 8,
      overflow: 'hidden',
      backgroundColor: theme.surface,
    },
    providerGroupActive: { borderColor: theme.primary },
    providerHeader: {
      minHeight: 62,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 11,
      gap: 9,
    },
    providerMark: {
      width: 32,
      height: 32,
      borderRadius: 9,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.primaryLight,
    },
    providerCopy: { flex: 1 },
    groupLabel: {
      fontSize: 14,
      fontWeight: '700',
      color: theme.textPrimary,
    },
    providerMeta: { fontSize: 11, color: theme.textTertiary, marginTop: 3 },
    protocolPill: {
      minWidth: 31,
      borderRadius: 8,
      paddingHorizontal: 6,
      paddingVertical: 3,
      backgroundColor: theme.primaryLight,
      alignItems: 'center',
    },
    protocolPillAnthropic: { backgroundColor: theme.bannerBg },
    protocolPillText: { color: theme.primary, fontSize: 9, fontWeight: '800' },
    protocolPillTextAnthropic: { color: theme.bannerText },
    providerModels: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.border,
      paddingVertical: 4,
      backgroundColor: theme.background,
    },
    modelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 11,
      paddingHorizontal: 12,
    },
    modelRowActive: { backgroundColor: theme.primaryLight },
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
    searchScreen: { flex: 1 },
    searchHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 12,
      paddingTop: RNPlatform.OS === 'android' ? 14 : 50,
      paddingBottom: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
      backgroundColor: theme.surface,
    },
    searchBack: { width: 34, height: 40, alignItems: 'center', justifyContent: 'center' },
    searchInputWrap: {
      flex: 1,
      height: 42,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
      borderRadius: 21,
      paddingHorizontal: 12,
      backgroundColor: theme.surfaceVariant,
    },
    searchInput: { flex: 1, color: theme.textPrimary, fontSize: 15, paddingVertical: 8 },
    searchCount: {
      color: theme.textTertiary,
      fontSize: 12,
      paddingHorizontal: 18,
      paddingVertical: 10,
    },
    searchResults: { paddingHorizontal: 12, paddingBottom: 28, flexGrow: 1 },
    searchResult: {
      borderRadius: 12,
      padding: 13,
      marginBottom: 9,
      backgroundColor: theme.surfaceVariant,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
    },
    searchResultHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
    searchResultRole: { color: theme.primary, fontSize: 12, fontWeight: '700' },
    searchResultTime: { color: theme.textTertiary, fontSize: 11 },
    searchResultText: { color: theme.textPrimary, fontSize: 14, lineHeight: 20 },
    searchEmpty: { color: theme.textTertiary, textAlign: 'center', marginTop: 52 },
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
