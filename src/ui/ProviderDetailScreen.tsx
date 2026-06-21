// 服务商详情页（设置二级页）—— 编辑/新增一个服务商
// 名称/类型/baseURL/Key + 获取模型弹窗 + 已添加模型列表 + 删除
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useChatStore } from '../store';
import { getProviderKey } from '../settings';
import { makeProvider } from '../providers/factory';
import type { ProviderType } from '../types';

export default function ProviderDetailScreen({
  providerId,
  onBack,
}: {
  providerId: string | null; // null = 新增
  onBack: () => void;
}) {
  const providers = useChatStore((s) => s.settings.providers);
  const addProvider = useChatStore((s) => s.addProvider);
  const updateProvider = useChatStore((s) => s.updateProvider);
  const removeProvider = useChatStore((s) => s.removeProvider);
  const saveProviderKey = useChatStore((s) => s.saveProviderKey);

  const existing = providers.find((p) => p.id === providerId) ?? null;

  const [name, setName] = useState(existing?.name ?? '');
  const [type, setType] = useState<ProviderType>(existing?.type ?? 'openai');
  const [baseURL, setBaseURL] = useState(existing?.baseURL ?? '');
  const [apiKey, setKey] = useState('');
  const [models, setModels] = useState<string[]>(existing?.models ?? []);
  const [newModel, setNewModel] = useState('');
  const [saved, setSaved] = useState(false);

  // 获取模型弹窗状态
  const [pickerOpen, setPickerOpen] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchErr, setFetchErr] = useState<string | null>(null);
  const [fetched, setFetched] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (existing) getProviderKey(existing.id).then((k) => k && setKey(k));
  }, [existing?.id]);

  // 点「获取模型」：用当前填写的 url/type/key 临时造 provider 拉列表
  async function handleFetch() {
    const url = baseURL.trim();
    if (!url) {
      setFetchErr('请先填写 Base URL');
      setPickerOpen(true);
      return;
    }
    setPickerOpen(true);
    setFetching(true);
    setFetchErr(null);
    setFetched([]);
    try {
      const inst = makeProvider({ id: 'tmp', name, type, baseURL: url, models: [] });
      const list = await inst.listModels(apiKey.trim());
      setFetched(list);
      // 已添加过的默认勾选
      setSelected(new Set(list.filter((m) => models.includes(m))));
      if (!list.length) setFetchErr('该服务商没有返回任何模型');
    } catch (e: any) {
      setFetchErr(e?.message ?? String(e));
    } finally {
      setFetching(false);
    }
  }

  function toggle(m: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(m) ? next.delete(m) : next.add(m);
      return next;
    });
  }

  // 弹窗「完成」：把勾选的模型并入已添加列表
  function confirmPick() {
    setModels((prev) => Array.from(new Set([...prev, ...selected])));
    setPickerOpen(false);
  }

  function addManual() {
    const m = newModel.trim();
    if (!m) return;
    setModels((prev) => Array.from(new Set([...prev, m])));
    setNewModel('');
  }

  function delModel(m: string) {
    setModels((prev) => prev.filter((x) => x !== m));
  }

  async function handleSave() {
    const payload = {
      name: name.trim() || '未命名服务商',
      type,
      baseURL: baseURL.trim(),
      models,
    };
    let id = existing?.id;
    if (id) {
      await updateProvider(id, payload);
    } else {
      id = await addProvider(payload);
    }
    if (apiKey.trim()) await saveProviderKey(id, apiKey);
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onBack();
    }, 600);
  }

  async function handleDelete() {
    if (existing) await removeProvider(existing.id);
    onBack();
  }

  return (
    <View style={styles.flex}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={8}>
          <Text style={styles.headerBtn}>← 返回</Text>
        </Pressable>
        <Text style={styles.headerTitle}>
          {existing ? '编辑服务商' : '添加服务商'}
        </Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.label}>名称</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="例如：硅基流动"
          placeholderTextColor="#999"
        />

        <Text style={styles.label}>API 类型</Text>
        <View style={styles.segment}>
          {(['openai', 'anthropic'] as ProviderType[]).map((t) => (
            <Pressable
              key={t}
              style={[styles.segBtn, type === t && styles.segBtnActive]}
              onPress={() => setType(t)}
            >
              <Text style={[styles.segText, type === t && styles.segTextActive]}>
                {t === 'openai' ? 'OpenAI 兼容' : 'Anthropic'}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Base URL</Text>
        <TextInput
          style={styles.input}
          value={baseURL}
          onChangeText={setBaseURL}
          placeholder={type === 'openai' ? 'https://api.xxx.com/v1' : 'https://api.anthropic.com'}
          placeholderTextColor="#999"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text style={styles.label}>API Key</Text>
        <TextInput
          style={styles.input}
          value={apiKey}
          onChangeText={setKey}
          placeholder="sk-…"
          placeholderTextColor="#999"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Text style={styles.hint}>存于系统钥匙串，不会明文落盘</Text>

        <Pressable style={styles.fetchBtn} onPress={handleFetch}>
          <Text style={styles.fetchText}>⬇ 获取模型</Text>
        </Pressable>

        <Text style={styles.label}>已添加的模型</Text>
        {models.length === 0 && (
          <Text style={styles.hint}>还没有模型，点上方「获取模型」或手动添加</Text>
        )}
        {models.map((m) => (
          <View key={m} style={styles.modelRow}>
            <Text style={styles.modelName} numberOfLines={1}>{m}</Text>
            <Pressable onPress={() => delModel(m)} hitSlop={8}>
              <Text style={styles.modelDel}>🗑</Text>
            </Pressable>
          </View>
        ))}
        <View style={styles.addRow}>
          <TextInput
            style={[styles.input, styles.addInput]}
            value={newModel}
            onChangeText={setNewModel}
            placeholder="手动添加模型 ID"
            placeholderTextColor="#999"
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={addManual}
          />
          <Pressable
            style={[styles.addBtn, !newModel.trim() && styles.addBtnDisabled]}
            onPress={addManual}
            disabled={!newModel.trim()}
          >
            <Text style={styles.addBtnText}>添加</Text>
          </Pressable>
        </View>

        <Pressable style={styles.saveBtn} onPress={handleSave}>
          <Text style={styles.saveText}>{saved ? '已保存 ✓' : '保存'}</Text>
        </Pressable>

        {existing && (
          <Pressable style={styles.delBtn} onPress={handleDelete}>
            <Text style={styles.delBtnText}>删除此服务商</Text>
          </Pressable>
        )}
      </ScrollView>

      <Modal
        visible={pickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>选择要添加的模型</Text>
            {fetching ? (
              <View style={styles.modalLoading}>
                <ActivityIndicator size="large" />
                <Text style={styles.hint}>正在获取…</Text>
              </View>
            ) : fetchErr ? (
              <Text style={styles.modalErr}>{fetchErr}</Text>
            ) : (
              <ScrollView style={styles.modalList}>
                {fetched.map((m) => {
                  const on = selected.has(m);
                  return (
                    <Pressable key={m} style={styles.pickRow} onPress={() => toggle(m)}>
                      <Text style={styles.pickCheck}>{on ? '☑' : '☐'}</Text>
                      <Text style={styles.pickName} numberOfLines={1}>{m}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
            <View style={styles.modalBtns}>
              <Pressable style={styles.modalCancel} onPress={() => setPickerOpen(false)}>
                <Text style={styles.modalCancelText}>取消</Text>
              </Pressable>
              <Pressable
                style={[styles.modalDone, !selected.size && styles.addBtnDisabled]}
                onPress={confirmPick}
                disabled={!selected.size}
              >
                <Text style={styles.modalDoneText}>完成（{selected.size}）</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
// ===STYLES_BELOW===

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
    backgroundColor: '#fafafa',
  },
  headerTitle: { fontSize: 16, fontWeight: '600' },
  headerBtn: { fontSize: 14, color: '#2563eb' },
  content: { padding: 16, paddingBottom: 48 },
  label: { fontSize: 14, fontWeight: '600', marginTop: 16, marginBottom: 6 },
  hint: { fontSize: 12, color: '#999', marginTop: 4, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  segment: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    overflow: 'hidden',
  },
  segBtn: { flex: 1, paddingVertical: 10, alignItems: 'center' },
  segBtnActive: { backgroundColor: '#2563eb' },
  segText: { fontSize: 14, color: '#333' },
  segTextActive: { color: '#fff', fontWeight: '600' },
  fetchBtn: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#2563eb',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  fetchText: { color: '#2563eb', fontWeight: '600', fontSize: 15 },
  modelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  modelName: { fontSize: 15, color: '#333', flex: 1, marginRight: 8 },
  modelDel: { fontSize: 15 },
  addRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  addInput: { flex: 1 },
  addBtn: {
    marginLeft: 8,
    backgroundColor: '#2563eb',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  addBtnDisabled: { backgroundColor: '#9db9f0', opacity: 0.6 },
  addBtnText: { color: '#fff', fontWeight: '600' },
  saveBtn: {
    backgroundColor: '#2563eb',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 28,
  },
  saveText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  delBtn: {
    borderWidth: 1,
    borderColor: '#dc2626',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 16,
  },
  delBtnText: { color: '#dc2626', fontWeight: '600' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: 24,
  },
  modalSheet: {
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 12,
    maxHeight: '80%',
  },
  modalTitle: {
    fontSize: 15,
    fontWeight: '600',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  modalLoading: { padding: 32, alignItems: 'center' },
  modalErr: { color: '#b91c1c', padding: 16, fontSize: 13 },
  modalList: { paddingHorizontal: 8 },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 11,
  },
  pickCheck: { fontSize: 18, marginRight: 10, color: '#2563eb' },
  pickName: { fontSize: 15, color: '#222', flex: 1 },
  modalBtns: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#eee',
    marginTop: 8,
    paddingTop: 10,
    paddingHorizontal: 16,
  },
  modalCancel: { flex: 1, paddingVertical: 10, alignItems: 'center' },
  modalCancelText: { color: '#666', fontSize: 15 },
  modalDone: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#2563eb',
    borderRadius: 10,
  },
  modalDoneText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
