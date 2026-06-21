// 侧边栏抽屉 —— 自研滑动抽屉（Animated + 遮罩），不引第三方库
// 内含：＋新对话 / 会话列表（点选 + 删除）/ 设置入口
import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useChatStore } from '../store';
import type { Session } from '../types';

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
  const insets = useSafeAreaInsets();
  const sessions = useChatStore((s) => s.sessions);
  const currentSessionId = useChatStore((s) => s.currentSessionId);
  const newSession = useChatStore((s) => s.newSession);
  const selectSession = useChatStore((s) => s.selectSession);
  const removeSession = useChatStore((s) => s.removeSession);
  const renameSession = useChatStore((s) => s.renameSession);

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
      Animated.timing(tx, {
        toValue: open ? 0 : -DRAWER_W,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.timing(fade, {
        toValue: open ? 1 : 0,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start();
  }, [open, tx, fade]);

  async function handleNew() {
    await newSession();
    onClose();
  }

  async function handleSelect(id: string) {
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

        <Pressable style={styles.newBtn} onPress={handleNew}>
          <Text style={styles.newBtnText}>＋ 新对话</Text>
        </Pressable>

        <Text style={styles.sectionLabel}>聊天记录</Text>

        <FlatList
          style={styles.flex}
          data={sessions}
          keyExtractor={(s) => s.id}
          ListEmptyComponent={
            <Text style={styles.emptyHint}>还没有对话</Text>
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

        <Pressable
          style={[styles.footer, { paddingBottom: insets.bottom + 14 }]}
          onPress={() => {
            onClose();
            onOpenSettings();
          }}
        >
          <Text style={styles.footerText}>⚙  设置</Text>
        </Pressable>
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
              placeholderTextColor="#999"
              onSubmitEditing={commitRename}
            />
            <View style={styles.renameBtns}>
              <Pressable style={styles.renameCancel} onPress={() => setEditing(null)}>
                <Text style={styles.renameCancelText}>取消</Text>
              </Pressable>
              <Pressable style={styles.renameOk} onPress={commitRename}>
                <Text style={styles.renameOkText}>确定</Text>
              </Pressable>
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
  return (
    <Pressable
      style={[styles.row, active && styles.rowActive]}
      onPress={onPress}
    >
      <Text
        style={[styles.rowTitle, active && styles.rowTitleActive]}
        numberOfLines={1}
      >
        {session.title}
      </Text>
      <Pressable onPress={onRename} hitSlop={10} style={styles.rowAction}>
        <Text style={styles.edit}>✏</Text>
      </Pressable>
      <Pressable onPress={onDelete} hitSlop={10} style={styles.rowAction}>
        <Text style={styles.del}>🗑</Text>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  drawer: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#fff',
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: '#ddd',
    elevation: 16,
  },
  newBtn: {
    margin: 12,
    backgroundColor: '#2563eb',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  newBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  sectionLabel: {
    fontSize: 12,
    color: '#999',
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  emptyHint: { color: '#bbb', textAlign: 'center', marginTop: 24, fontSize: 13 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  rowActive: { backgroundColor: '#eef2ff' },
  rowTitle: { flex: 1, fontSize: 15, color: '#333', marginRight: 8 },
  rowTitleActive: { color: '#2563eb', fontWeight: '600' },
  del: { fontSize: 15 },
  rowAction: { flexDirection: 'row', alignItems: 'center' },
  edit: { fontSize: 14, marginRight: 12 },
  renameBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 28,
  },
  renameSheet: { backgroundColor: '#fff', borderRadius: 14, padding: 18 },
  renameTitle: { fontSize: 15, fontWeight: '600', marginBottom: 12 },
  renameInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  renameBtns: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 16,
  },
  renameCancel: { paddingHorizontal: 16, paddingVertical: 8, marginRight: 8 },
  renameCancelText: { color: '#666', fontSize: 15 },
  renameOk: {
    backgroundColor: '#2563eb',
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  renameOkText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#eee',
    paddingTop: 14,
    paddingHorizontal: 16,
  },
  footerText: { fontSize: 15, color: '#333' },
});
