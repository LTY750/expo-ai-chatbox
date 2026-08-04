// 服务商详情页（设置二级页）—— 编辑/新增一个服务商
// 名称/类型/baseURL/Key + 获取模型弹窗 + 已添加模型列表 + 删除
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useChatStore } from '../store';
import { getProviderKey } from '../settings';
import { makeProvider } from '../providers/factory';
import { useTheme, type ThemeColors } from '../theme';
import type { ProviderType } from '../types';
import { AppIcon } from './AppIcon';
import { MotionPressable } from './MotionPressable';

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

interface ModelTestResult {
  ok: boolean;
  text: string;
}

export default function ProviderDetailScreen({
  providerId,
  onBack,
}: {
  providerId: string | null; // null = 新增
  onBack: () => void;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

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
  const [keyLoaded, setKeyLoaded] = useState(!existing);
  const [keyLoadError, setKeyLoadError] = useState<string | null>(null);
  const [keyLoadAttempt, setKeyLoadAttempt] = useState(0);
  const keyDirtyRef = useRef(false);
  const createdProviderIdRef = useRef<string | null>(existing?.id ?? null);
  const [models, setModels] = useState<string[]>(existing?.models ?? []);
  const [newModel, setNewModel] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testingModel, setTestingModel] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, ModelTestResult>>({});
  const testAbortRef = useRef<AbortController | null>(null);
  const testRunIdRef = useRef(0);

  // 获取模型弹窗状态
  const [pickerOpen, setPickerOpen] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchErr, setFetchErr] = useState<string | null>(null);
  const [fetched, setFetched] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    createdProviderIdRef.current = existing?.id ?? null;
    keyDirtyRef.current = false;
    setKey('');
    setKeyLoadError(null);
    if (!existing) {
      setKeyLoaded(true);
      return () => {
        cancelled = true;
      };
    }
    setKeyLoaded(false);
    getProviderKey(existing.id)
      .then((k) => {
        if (cancelled) return;
        if (!keyDirtyRef.current) setKey(k ?? '');
        setKeyLoaded(true);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setKeyLoaded(false);
        setKeyLoadError(`读取 API Key 失败：${errorMessage(error)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [existing?.id, keyLoadAttempt]);

  useEffect(() => () => {
    testRunIdRef.current += 1;
    testAbortRef.current?.abort();
    testAbortRef.current = null;
  }, []);

  // API 配置变化后，旧测试结果已不再代表当前配置；同时结束仍在进行的请求。
  useEffect(() => {
    testRunIdRef.current += 1;
    testAbortRef.current?.abort();
    testAbortRef.current = null;
    setTestingModel(null);
    setTestResults({});
  }, [type, baseURL, apiKey]);

  // 点「获取模型」：用当前填写的 url/type/key 临时造 provider 拉列表
  async function handleFetch() {
    if (testingModel) return;
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
    if (testingModel) return;
    const m = newModel.trim();
    if (!m) return;
    setModels((prev) => Array.from(new Set([...prev, m])));
    setNewModel('');
  }

  function delModel(m: string) {
    setModels((prev) => prev.filter((x) => x !== m));
    setTestResults((prev) => {
      const next = { ...prev };
      delete next[m];
      return next;
    });
  }

  async function handleSave() {
    if (saving || testingModel || !keyLoaded) return;
    setSaving(true);
    setSaveError(null);
    const payload = {
      name: name.trim() || '未命名服务商',
      type,
      baseURL: baseURL.trim(),
      models,
    };
    let providerInfoSaved = false;
    try {
      let id = existing?.id ?? createdProviderIdRef.current;
      if (id) {
        await updateProvider(id, payload);
      } else {
        id = await addProvider(payload);
        // 如果后续 SecureStore 写入失败，重试时更新这个服务商，不再重复新增。
        createdProviderIdRef.current = id;
      }
      providerInfoSaved = true;
      if (!existing || keyDirtyRef.current) await saveProviderKey(id, apiKey);
      setSaving(false);
      onBack();
    } catch (error: unknown) {
      const prefix = !existing && providerInfoSaved
        ? '服务商信息已保存，但密钥保存失败'
        : '保存服务商失败';
      setSaveError(`${prefix}：${errorMessage(error)}`);
      setSaving(false);
    }
  }

  async function handleTest(model: string) {
    if (testingModel || !keyLoaded) return;
    const url = baseURL.trim();
    const targetModel = model.trim();
    if (!url) {
      setTestResults((prev) => ({
        ...prev,
        [targetModel]: { ok: false, text: '请先填写 Base URL' },
      }));
      return;
    }
    if (!apiKey.trim()) {
      setTestResults((prev) => ({
        ...prev,
        [targetModel]: { ok: false, text: '请先填写 API Key' },
      }));
      return;
    }
    if (!targetModel) return;

    const runId = ++testRunIdRef.current;
    const startedAt = Date.now();
    setTestingModel(targetModel);
    setTestResults((prev) => {
      const next = { ...prev };
      delete next[targetModel];
      return next;
    });
    const controller = new AbortController();
    testAbortRef.current = controller;
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const inst = makeProvider({
        id: 'connection-test',
        name,
        type,
        baseURL: url,
        models: [targetModel],
      });
      const reply = await inst.complete({
        messages: [{ role: 'user', content: '这是连接测试。请只回复 OK。' }],
        settings: { model: targetModel, temperature: 0, maxTokens: 16 },
        apiKey: apiKey.trim(),
        signal: controller.signal,
      });
      if (testRunIdRef.current !== runId) return;
      const preview = reply.trim().replace(/\s+/g, ' ').slice(0, 120);
      const elapsed = Date.now() - startedAt;
      setTestResults((prev) => ({
        ...prev,
        [targetModel]: {
          ok: true,
          text: `连接成功 · ${elapsed} ms${preview ? ` · 返回：${preview}` : ''}`,
        },
      }));
    } catch (error: any) {
      if (testRunIdRef.current !== runId) return;
      const elapsed = Date.now() - startedAt;
      setTestResults((prev) => ({
        ...prev,
        [targetModel]: {
          ok: false,
          text: error?.name === 'AbortError'
            ? '测试超时（20 秒），请检查网址、网络和服务状态'
            : `连接失败 · ${elapsed} ms：${errorMessage(error)}`,
        },
      }));
    } finally {
      clearTimeout(timer);
      if (testRunIdRef.current === runId) {
        testAbortRef.current = null;
        setTestingModel(null);
      }
    }
  }

  async function handleDelete() {
    if (!existing || saving || testingModel) return;
    setSaving(true);
    setSaveError(null);
    try {
      await removeProvider(existing.id);
      setSaving(false);
      onBack();
    } catch (error: unknown) {
      setSaveError(`删除服务商失败：${errorMessage(error)}`);
      setSaving(false);
    }
  }

  function renderModelTestButton(model: string) {
    const isTesting = testingModel === model;
    const disabled = !keyLoaded || saving || testingModel !== null;
    return (
      <MotionPressable
        style={[styles.modelTestBtn, disabled && !isTesting && styles.disabled]}
        onPress={() => handleTest(model)}
        disabled={disabled}
        accessibilityLabel={`测试模型 ${model}`}
      >
        {isTesting ? (
          <ActivityIndicator size="small" color={theme.primary} />
        ) : (
          <AppIcon name="send" size={15} color={theme.primary} />
        )}
        <Text style={styles.modelTestText}>{isTesting ? '测试中' : '测试'}</Text>
      </MotionPressable>
    );
  }

  function renderModelTestResult(model: string) {
    const result = testResults[model];
    if (!result) return null;
    return (
      <View style={[styles.testResult, result.ok ? styles.testSuccess : styles.testFailure]}>
        <AppIcon
          name={result.ok ? 'check' : 'close'}
          size={17}
          color={result.ok ? '#15803d' : theme.danger}
        />
        <Text style={[
          styles.testResultText,
          result.ok ? styles.testSuccessText : styles.testFailureText,
        ]}>
          {result.text}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <View style={styles.header}>
        <MotionPressable style={styles.headerBack} onPress={onBack} hitSlop={8} disabled={saving}>
          <AppIcon name="back" size={24} color={theme.primary} />
          <Text style={[styles.headerBtn, saving && styles.disabled]}>返回</Text>
        </MotionPressable>
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
          placeholderTextColor={theme.placeholder}
        />

        <Text style={styles.label}>API 类型</Text>
        <View style={styles.segment}>
          {(['openai', 'anthropic'] as ProviderType[]).map((t) => (
            <MotionPressable
              key={t}
              style={[styles.segBtn, type === t && styles.segBtnActive]}
              onPress={() => setType(t)}
            >
              <Text style={[styles.segText, type === t && styles.segTextActive]}>
                {t === 'openai' ? 'OpenAI 兼容' : 'Anthropic'}
              </Text>
            </MotionPressable>
          ))}
        </View>
        <View style={styles.protocolHint}>
          <Text style={styles.protocolHintTitle}>
            {type === 'openai' ? 'OpenAI 兼容协议' : 'Anthropic 原生协议'}
          </Text>
          <Text style={styles.protocolHintText}>
            {type === 'openai'
              ? '对话请求：Base URL + /chat/completions · Bearer 认证'
              : '对话请求：Base URL + /v1/messages · x-api-key 认证'}
          </Text>
        </View>

        <Text style={styles.label}>Base URL</Text>
        <TextInput
          style={styles.input}
          value={baseURL}
          onChangeText={setBaseURL}
          placeholder={type === 'openai' ? 'https://api.xxx.com/v1' : 'https://api.anthropic.com'}
          placeholderTextColor={theme.placeholder}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text style={styles.label}>API Key</Text>
        <TextInput
          style={[styles.input, (!keyLoaded || saving) && styles.disabled]}
          value={apiKey}
          onChangeText={(value) => {
            keyDirtyRef.current = true;
            setKey(value);
          }}
          placeholder="sk-…"
          placeholderTextColor={theme.placeholder}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          editable={keyLoaded && !saving}
        />
        <Text style={styles.hint}>存于系统钥匙串，不会明文落盘</Text>
        {keyLoadError && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{keyLoadError}</Text>
            <MotionPressable
              style={styles.inlineButton}
              onPress={() => setKeyLoadAttempt((attempt) => attempt + 1)}
            >
              <AppIcon name="retry" size={17} color={theme.primary} />
              <Text style={styles.retryText}>重试加载</Text>
            </MotionPressable>
          </View>
        )}

        <MotionPressable
          style={[styles.fetchBtn, (!keyLoaded || saving || !!testingModel) && styles.disabled]}
          onPress={handleFetch}
          disabled={!keyLoaded || saving || !!testingModel}
        >
          <View style={styles.inlineButton}>
            <AppIcon name="retry" size={18} color={theme.primary} />
            <Text style={styles.fetchText}>获取模型</Text>
          </View>
        </MotionPressable>

        <Text style={styles.label}>已添加的模型 · 单独测试</Text>
        <Text style={styles.hint}>
          每个模型都会使用上方配置发送一条极短请求，可能产生少量 API 费用。
        </Text>
        {models.length === 0 && (
          <Text style={styles.hint}>还没有模型，点上方「获取模型」或手动添加</Text>
        )}
        {models.map((m) => (
          <View key={m} style={styles.modelCard}>
            <View style={styles.modelRow}>
              <Text style={styles.modelName} numberOfLines={1}>{m}</Text>
              <View style={styles.modelActions}>
                {renderModelTestButton(m)}
                <MotionPressable
                  style={styles.modelDeleteBtn}
                  onPress={() => delModel(m)}
                  hitSlop={6}
                  disabled={!!testingModel}
                  accessibilityLabel={`删除模型 ${m}`}
                >
                  <AppIcon name="delete" size={18} color={theme.danger} />
                </MotionPressable>
              </View>
            </View>
            {renderModelTestResult(m)}
          </View>
        ))}
        <View style={styles.addRow}>
          <TextInput
            style={[styles.input, styles.addInput]}
            value={newModel}
            onChangeText={setNewModel}
            placeholder="手动添加模型 ID"
            placeholderTextColor={theme.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={addManual}
          />
          <MotionPressable
            style={[
              styles.addBtn,
              (!newModel.trim() || !!testingModel) && styles.addBtnDisabled,
            ]}
            onPress={addManual}
            disabled={!newModel.trim() || !!testingModel}
          >
            <View style={styles.inlineButton}>
              <AppIcon name="add" size={17} color="#fff" />
              <Text style={styles.addBtnText}>添加</Text>
            </View>
          </MotionPressable>
        </View>

        <MotionPressable
          style={[styles.saveBtn, (!keyLoaded || saving || !!testingModel) && styles.disabled]}
          onPress={handleSave}
          disabled={!keyLoaded || saving || !!testingModel}
        >
          <View style={styles.inlineButton}>
            <AppIcon name="check" size={18} color="#fff" />
            <Text style={styles.saveText}>{saving ? '保存中…' : '保存'}</Text>
          </View>
        </MotionPressable>
        {saveError && <Text style={styles.saveError}>{saveError}</Text>}

        {existing && (
          <MotionPressable
            style={[styles.delBtn, (saving || !!testingModel) && styles.disabled]}
            onPress={handleDelete}
            disabled={saving || !!testingModel}
          >
            <View style={styles.inlineButton}>
              <AppIcon name="delete" size={18} color={theme.danger} />
              <Text style={styles.delBtnText}>删除此服务商</Text>
            </View>
          </MotionPressable>
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
                <ActivityIndicator size="large" color={theme.primary} />
                <Text style={styles.hint}>正在获取…</Text>
              </View>
            ) : fetchErr ? (
              <Text style={styles.modalErr}>{fetchErr}</Text>
            ) : (
              <ScrollView style={styles.modalList}>
                {fetched.map((m) => {
                  const on = selected.has(m);
                  return (
                    <View key={m} style={styles.pickCard}>
                      <View style={styles.pickRow}>
                        <MotionPressable style={styles.pickSelect} onPress={() => toggle(m)}>
                          <AppIcon
                            name={on ? 'check' : 'add'}
                            size={18}
                            color={on ? theme.primary : theme.textTertiary}
                            style={styles.pickCheck}
                          />
                          <Text style={styles.pickName} numberOfLines={1}>{m}</Text>
                        </MotionPressable>
                        {renderModelTestButton(m)}
                      </View>
                      {renderModelTestResult(m)}
                    </View>
                  );
                })}
              </ScrollView>
            )}
            <View style={styles.modalBtns}>
              <MotionPressable style={styles.modalCancel} onPress={() => setPickerOpen(false)}>
                <Text style={styles.modalCancelText}>取消</Text>
              </MotionPressable>
              <MotionPressable
                style={[styles.modalDone, !selected.size && styles.addBtnDisabled]}
                onPress={confirmPick}
                disabled={!selected.size}
              >
                <Text style={styles.modalDoneText}>完成（{selected.size}）</Text>
              </MotionPressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function createStyles(theme: ThemeColors) {
  return StyleSheet.create({
    flex: { flex: 1, backgroundColor: theme.background },
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
    headerTitle: { fontSize: 16, fontWeight: '600', color: theme.textPrimary },
    headerBack: { flexDirection: 'row', alignItems: 'center', minWidth: 54 },
    headerBtn: { fontSize: 14, color: theme.primary },
    content: { padding: 16, paddingBottom: 48 },
    label: { fontSize: 14, fontWeight: '600', marginTop: 16, marginBottom: 6, color: theme.textPrimary },
    hint: { fontSize: 12, color: theme.textTertiary, marginTop: 4, marginBottom: 6 },
    errorBox: {
      borderWidth: 1,
      borderColor: theme.danger,
      borderRadius: 10,
      padding: 10,
      marginTop: 8,
    },
    errorText: { color: theme.danger, fontSize: 13, lineHeight: 18 },
    retryText: { color: theme.primary, fontWeight: '600' },
    inlineButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
    input: {
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      color: theme.textPrimary,
      backgroundColor: theme.inputBg,
    },
    segment: {
      flexDirection: 'row',
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 10,
      overflow: 'hidden',
    },
    segBtn: { flex: 1, paddingVertical: 10, alignItems: 'center' },
    segBtnActive: { backgroundColor: theme.primary },
    segText: { fontSize: 14, color: theme.textPrimary },
    segTextActive: { color: '#fff', fontWeight: '600' },
    protocolHint: {
      marginTop: 8,
      borderRadius: 9,
      paddingHorizontal: 11,
      paddingVertical: 9,
      backgroundColor: theme.primaryLight,
    },
    protocolHintTitle: { color: theme.primary, fontSize: 12, fontWeight: '700' },
    protocolHintText: { color: theme.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 2 },
    fetchBtn: {
      marginTop: 16,
      borderWidth: 1,
      borderColor: theme.primary,
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: 'center',
    },
    fetchText: { color: theme.primary, fontWeight: '600', fontSize: 15 },
    testResult: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 7,
      marginHorizontal: 10,
      marginBottom: 10,
      padding: 10,
      borderRadius: 9,
      borderWidth: 1,
    },
    testSuccess: { backgroundColor: '#ecfdf5', borderColor: '#86efac' },
    testFailure: { backgroundColor: theme.bannerBg, borderColor: theme.danger },
    testResultText: { flex: 1, fontSize: 12, lineHeight: 17 },
    testSuccessText: { color: '#166534' },
    testFailureText: { color: theme.danger },
    modelCard: {
      marginTop: 8,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 11,
      backgroundColor: theme.surface,
      overflow: 'hidden',
    },
    modelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 10,
      paddingVertical: 9,
    },
    modelName: { fontSize: 14, color: theme.textPrimary, flex: 1, marginRight: 6 },
    modelActions: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    modelTestBtn: {
      minWidth: 66,
      minHeight: 34,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      paddingHorizontal: 8,
      borderWidth: 1,
      borderColor: theme.primary,
      borderRadius: 9,
      backgroundColor: theme.primaryLight,
    },
    modelTestText: { color: theme.primary, fontSize: 12, fontWeight: '700' },
    modelDeleteBtn: {
      width: 34,
      height: 34,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 9,
    },
    addRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
    addInput: { flex: 1 },
    addBtn: {
      marginLeft: 8,
      backgroundColor: theme.primary,
      borderRadius: 10,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    addBtnDisabled: { backgroundColor: '#9db9f0', opacity: 0.6 },
    disabled: { opacity: 0.5 },
    addBtnText: { color: '#fff', fontWeight: '600' },
    saveBtn: {
      backgroundColor: theme.primary,
      borderRadius: 10,
      paddingVertical: 14,
      alignItems: 'center',
      marginTop: 28,
    },
    saveText: { color: '#fff', fontSize: 16, fontWeight: '600' },
    saveError: { color: theme.danger, fontSize: 13, lineHeight: 18, marginTop: 10 },
    delBtn: {
      borderWidth: 1,
      borderColor: theme.danger,
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: 'center',
      marginTop: 16,
    },
    delBtnText: { color: theme.danger, fontWeight: '600' },
    modalBackdrop: {
      flex: 1,
      backgroundColor: theme.overlay,
      justifyContent: 'center',
      padding: 24,
    },
    modalSheet: {
      backgroundColor: theme.background,
      borderRadius: 14,
      paddingVertical: 12,
      maxHeight: '80%',
    },
    modalTitle: {
      fontSize: 15,
      fontWeight: '600',
      paddingHorizontal: 16,
      paddingBottom: 8,
      color: theme.textPrimary,
    },
    modalLoading: { padding: 32, alignItems: 'center' },
    modalErr: { color: theme.danger, padding: 16, fontSize: 13 },
    modalList: { paddingHorizontal: 8 },
    pickCard: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.borderLight,
    },
    pickRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 4,
    },
    pickSelect: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 8,
      paddingVertical: 9,
    },
    pickCheck: { marginRight: 10 },
    pickName: { fontSize: 15, color: theme.textPrimary, flex: 1 },
    modalBtns: {
      flexDirection: 'row',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.borderLight,
      marginTop: 8,
      paddingTop: 10,
      paddingHorizontal: 16,
    },
    modalCancel: { flex: 1, paddingVertical: 10, alignItems: 'center' },
    modalCancelText: { color: theme.textSecondary, fontSize: 15 },
    modalDone: {
      flex: 1,
      paddingVertical: 10,
      alignItems: 'center',
      backgroundColor: theme.primary,
      borderRadius: 10,
    },
    modalDoneText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  });
}
