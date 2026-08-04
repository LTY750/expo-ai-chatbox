// 侧边栏抽屉 —— 自研滑动抽屉（Animated + 遮罩），不引第三方库
// 内含：＋新对话 / 会话列表（点选 + 删除）/ 设置入口
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Dimensions,
  FlatList,
  Keyboard,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useChatStore } from '../store';
import { useTheme, type ThemeColors } from '../theme';
import type { Session } from '../types';
import { AppIcon } from './AppIcon';
import { MotionPressable } from './MotionPressable';

const SCREEN_W = Dimensions.get('window').width;
const DRAWER_W = Math.min(300, SCREEN_W * 0.82);

export default function Drawer({
  open,
  onClose,
  onOpenSettings,
}: {
  open: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const sessions = useChatStore((s) => s.sessions);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const newSession = useChatStore((s) => s.newSession);
  const selectSession = useChatStore((s) => s.selectSession);
  const removeSession = useChatStore((s) => s.removeSession);
  const renameSession = useChatStore((s) => s.renameSession);
  const [searchQuery, setSearchQuery] = useState('');

  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  const filteredSessions = useMemo(
    () =>
      normalizedQuery
        ? sessions.filter((session) =>
            session.title.toLocaleLowerCase().includes(normalizedQuery)
          )
        : sessions,
    [normalizedQuery, sessions]
  );

  // 改名弹窗
  const [editing, setEditing] = useState<Session | null>(null);
  const [editText, setEditText] = useState('');

  function startRename(s: Session) {
    setEditing(s);
    setEditText(s.title);
  }
  async function commitRename() {
    if (editing) await renameSession(editing.id, editText);
    setEditing(null);
  }

  // 滑动 + 遮罩淡入；用 ref 持有 Animated.Value
  const tx = useRef(new Animated.Value(-DRAWER_W)).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(tx, {
        toValue: open ? 0 : -DRAWER_W,
        stiffness: 260,
        damping: 26,
        mass: 0.85,
        useNativeDriver: true,
      }),
      Animated.timing(fade, {
        toValue: open ? 1 : 0,
        duration: open ? 180 : 140,
        useNativeDriver: true,
      }),
    ]).start();
  }, [open, tx, fade]);

  useEffect(() => {
    if (!open) {
      Keyboard.dismiss();
      setSearchQuery('');
    }
  }, [open]);

  async function handleNew() {
    Keyboard.dismiss();
    await newSession();
    onClose();
  }

  async function handleSelect(id: string) {
    Keyboard.dismiss();
    await selectSession(id);
    onClose();
  }

  return (
    // 关闭时整体不拦截触摸，避免挡住底层界面
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents={open ? 'auto' : 'none'}
    >
      <Animated.View style={[styles.backdrop, { opacity: fade }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>

      <Animated.View
        style={[
          styles.drawer,
          { width: DRAWER_W, transform: [{ translateX: tx }] },
        ]}
      >
        <View style={{ height: insets.top }} />

        <MotionPressable style={styles.newBtn} onPress={handleNew}>
          <AppIcon name="add" size={21} color={theme.textPrimary} />
          <Text style={styles.newBtnText}>新对话</Text>
        </MotionPressable>

        <View style={styles.searchBox}>
          <AppIcon name="search" size={18} color={theme.textSecondary} />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="搜索对话"
            placeholderTextColor={theme.placeholder}
            accessibilityLabel="搜索对话"
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
          />
          {!!searchQuery && (
            <MotionPressable
              style={styles.searchClear}
              onPress={() => setSearchQuery('')}
              hitSlop={8}
              accessibilityLabel="清空对话搜索"
            >
              <AppIcon name="close" size={16} color={theme.textSecondary} />
            </MotionPressable>
          )}
        </View>

        <Text style={styles.sectionLabel}>
          {normalizedQuery ? `搜索结果 · ${filteredSessions.length}` : '聊天记录'}
        </Text>

        <FlatList
          style={styles.flex}
          data={filteredSessions}
          keyExtractor={(s) => s.id}
          keyboardShouldPersistTaps="always"
          ListEmptyComponent={
            <Text style={styles.emptyHint}>
              {normalizedQuery ? '没有找到匹配的对话' : '还没有对话'}
            </Text>
          }
          renderItem={({ item }) => (
            <SessionRow
              session={item}
              active={item.id === currentSessionId}
              onPress={() => handleSelect(item.id)}
              onDelete={() => removeSession(item.id)}
              onRename={() => startRename(item)}
            />
          )}
        />

        <MotionPressable
          style={[styles.footer, { paddingBottom: insets.bottom + 14 }]}
          onPress={() => {
            onClose();
            onOpenSettings();
          }}
        >
          <AppIcon name="settings" size={21} color={theme.textPrimary} />
          <Text style={styles.footerText}>设置</Text>
        </MotionPressable>
      </Animated.View>

      <Modal
        visible={!!editing}
        transparent
        animationType="fade"
        onRequestClose={() => setEditing(null)}
      >
        <View style={styles.renameBackdrop}>
          <View style={styles.renameSheet}>
            <Text style={styles.renameTitle}>重命名对话</Text>
            <TextInput
              style={styles.renameInput}
              value={editText}
              onChangeText={setEditText}
              autoFocus
              placeholder="输入新名称"
              placeholderTextColor={theme.placeholder}
              onSubmitEditing={commitRename}
            />
            <View style={styles.renameBtns}>
              <MotionPressable style={styles.renameCancel} onPress={() => setEditing(null)}>
                <Text style={styles.renameCancelText}>取消</Text>
              </MotionPressable>
              <MotionPressable style={styles.renameOk} onPress={commitRename}>
                <View style={styles.inlineButton}>
                  <AppIcon name="check" size={17} color="#fff" />
                  <Text style={styles.renameOkText}>确定</Text>
                </View>
              </MotionPressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function SessionRow({
  session,
  active,
  onPress,
  onDelete,
  onRename,
}: {
  session: Session;
  active: boolean;
  onPress: () => void;
  onDelete: () => void;
  onRename: () => void;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  function handleDelete() {
    Alert.alert(
      '删除对话',
      `确定删除「${session.title}」吗？此操作不可恢复。`,
      [
        { text: '取消', style: 'cancel' },
        { text: '删除', style: 'destructive', onPress: onDelete },
      ]
    );
  }

  return (
    <MotionPressable
      style={[styles.row, active && styles.rowActive]}
      onPress={onPress}
      pressScale={0.98}
    >
      <Text
        style={[styles.rowTitle, active && styles.rowTitleActive]}
        numberOfLines={1}
      >
        {session.title}
      </Text>
      <MotionPressable onPress={onRename} hitSlop={10} style={styles.rowAction}>
        <AppIcon name="rename" size={15} color={theme.textSecondary} />
      </MotionPressable>
      <MotionPressable onPress={handleDelete} hitSlop={10} style={styles.rowAction}>
        <AppIcon name="delete" size={17} color={theme.danger} />
      </MotionPressable>
    </MotionPressable>
  );
}

function createStyles(theme: ThemeColors) {
  return StyleSheet.create({
    flex: { flex: 1 },
    backdrop: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: theme.overlay,
    },
    drawer: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      backgroundColor: theme.background,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderRightColor: theme.border,
      elevation: 16,
    },
    newBtn: {
      flexDirection: 'row',
      margin: 12,
      backgroundColor: theme.surfaceVariant,
      borderRadius: 14,
      paddingVertical: 12,
      alignItems: 'center',
      justifyContent: 'flex-start',
      paddingHorizontal: 14,
      gap: 7,
    },
    newBtnText: { color: theme.textPrimary, fontSize: 15, fontWeight: '600' },
    searchBox: {
      minHeight: 43,
      marginHorizontal: 12,
      marginBottom: 12,
      paddingHorizontal: 12,
      borderRadius: 13,
      backgroundColor: theme.inputBg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    searchInput: {
      flex: 1,
      paddingVertical: 9,
      fontSize: 15,
      color: theme.textPrimary,
    },
    searchClear: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sectionLabel: {
      fontSize: 12,
      color: theme.textTertiary,
      paddingHorizontal: 16,
      paddingBottom: 6,
    },
    emptyHint: { color: theme.textTertiary, textAlign: 'center', marginTop: 24, fontSize: 13 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    rowActive: { backgroundColor: theme.surfaceVariant },
    rowTitle: { flex: 1, fontSize: 15, color: theme.textPrimary, marginRight: 8 },
    rowTitleActive: { color: theme.textPrimary, fontWeight: '600' },
    rowAction: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
    },
    renameBackdrop: {
      flex: 1,
      backgroundColor: theme.overlay,
      justifyContent: 'center',
      padding: 28,
    },
    renameSheet: { backgroundColor: theme.background, borderRadius: 14, padding: 18 },
    renameTitle: { fontSize: 15, fontWeight: '600', marginBottom: 12, color: theme.textPrimary },
    renameInput: {
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      color: theme.textPrimary,
      backgroundColor: theme.inputBg,
    },
    renameBtns: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      marginTop: 16,
    },
    renameCancel: { paddingHorizontal: 16, paddingVertical: 8, marginRight: 8 },
    renameCancelText: { color: theme.textSecondary, fontSize: 15 },
    renameOk: {
      backgroundColor: theme.primary,
      borderRadius: 8,
      paddingHorizontal: 18,
      paddingVertical: 8,
    },
    renameOkText: { color: '#fff', fontSize: 15, fontWeight: '600' },
    inlineButton: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    footer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.borderLight,
      paddingTop: 14,
      paddingHorizontal: 16,
    },
    footerText: { fontSize: 15, color: theme.textPrimary },
  });
}
