// 设置页（一级）—— 外观主题 + 服务商列表 + 添加服务商 + 全局参数 + 文档解析(OCR)
import { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useChatStore } from '../store';
import { getOcrKey, getTavilyKey, getLlamaParseKey } from '../settings';
import { useTheme, type ThemeColors, type ThemeMode } from '../theme';
import ProviderDetailScreen from './ProviderDetailScreen';

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
];

export default function SettingsScreen({ onClose }: { onClose: () => void }) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const providers = useChatStore((s) => s.settings.providers);
  const systemPrompt = useChatStore((s) => s.settings.systemPrompt);
  const ocr = useChatStore((s) => s.settings.ocr);
  const updateSettings = useChatStore((s) => s.updateSettings);
  const updateOcr = useChatStore((s) => s.updateOcr);
  const saveOcrKey = useChatStore((s) => s.saveOcrKey);
  const saveTavilyKey = useChatStore((s) => s.saveTavilyKey);
  const saveLlamaParseKey = useChatStore((s) => s.saveLlamaParseKey);
  const themeMode = useChatStore((s) => s.themeMode);
  const setTheme = useChatStore((s) => s.setTheme);

  // null = 在列表页；'new' = 新增；其它 = 编辑某服务商
  const [editing, setEditing] = useState<string | null | 'new'>(null);
  const [sp, setSp] = useState(systemPrompt);
  const [saved, setSaved] = useState(false);

  // OCR 表单
  const [ocrURL, setOcrURL] = useState(ocr.baseURL);
  const [ocrModel, setOcrModel] = useState(ocr.model);
  const [ocrKey, setOcrKey] = useState('');
  const [ocrSaved, setOcrSaved] = useState(false);

  // Tavily 表单
  const [tavilyKey, setTavilyKey] = useState('');
  const [tavilySaved, setTavilySaved] = useState(false);

  // LlamaParse 表单
  const [llamaParseKey, setLlamaParseKey] = useState('');
  const [llamaParseSaved, setLlamaParseSaved] = useState(false);

  useEffect(() => {
    getOcrKey().then((k) => k && setOcrKey(k));
    getTavilyKey().then((k) => k && setTavilyKey(k));
    getLlamaParseKey().then((k) => k && setLlamaParseKey(k));
  }, []);

  if (editing !== null) {
    return (
      <ProviderDetailScreen
        providerId={editing === 'new' ? null : editing}
        onBack={() => setEditing(null)}
      />
    );
  }

  async function saveGlobal() {
    await updateSettings({ systemPrompt: sp });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  async function saveOcr() {
    await updateOcr({ baseURL: ocrURL.trim(), model: ocrModel.trim() });
    if (ocrKey.trim()) await saveOcrKey(ocrKey);
    setOcrSaved(true);
    setTimeout(() => setOcrSaved(false), 1500);
  }

  async function saveTavily() {
    // 始终调用：store 的 saveTavilyKey 在 key 为空时会删除已存的 key
    await saveTavilyKey(tavilyKey);
    setTavilySaved(true);
    setTimeout(() => setTavilySaved(false), 1500);
  }

  async function saveLlamaParse() {
    // 始终调用：store 的 saveLlamaParseKey 在 key 为空时会删除已存的 key
    await saveLlamaParseKey(llamaParseKey);
    setLlamaParseSaved(true);
    setTimeout(() => setLlamaParseSaved(false), 1500);
  }

  return (
    <View style={styles.flex}>
      <View style={styles.header}>
        <Pressable onPress={onClose} hitSlop={8}>
          <Text style={styles.headerBtn}>← 返回</Text>
        </Pressable>
        <Text style={styles.headerTitle}>设置</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* 外观主题切换 */}
        <Text style={styles.section}>外观</Text>
        <View style={styles.segment}>
          {THEME_OPTIONS.map((opt) => (
            <Pressable
              key={opt.value}
              style={[styles.segBtn, themeMode === opt.value && styles.segBtnActive]}
              onPress={() => setTheme(opt.value)}
            >
              <Text style={[styles.segText, themeMode === opt.value && styles.segTextActive]}>
                {opt.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.section}>API 服务商</Text>
        {providers.map((p) => (
          <Pressable key={p.id} style={styles.row} onPress={() => setEditing(p.id)}>
            <View style={styles.flex}>
              <Text style={styles.rowName}>{p.name}</Text>
              <Text style={styles.rowSub}>
                {p.type === 'openai' ? 'OpenAI 兼容' : 'Anthropic'} · {p.models.length} 个模型
              </Text>
            </View>
            <Text style={styles.chev}>›</Text>
          </Pressable>
        ))}
        <Pressable style={styles.addProvider} onPress={() => setEditing('new')}>
          <Text style={styles.addProviderText}>＋ 添加服务商</Text>
        </Pressable>

        <Text style={styles.section}>文档解析（图片 OCR）</Text>
        <Text style={styles.ocrHint}>
          用视觉模型识别图片/扫描件文字（如 DeepSeek-OCR）。文本文件 txt/md/csv 本地解析，无需配置。
        </Text>
        <Text style={styles.fieldLabel}>Base URL</Text>
        <TextInput
          style={styles.input}
          value={ocrURL}
          onChangeText={setOcrURL}
          placeholder="https://api.siliconflow.cn/v1"
          placeholderTextColor={theme.placeholder}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Text style={styles.fieldLabel}>OCR 模型</Text>
        <TextInput
          style={styles.input}
          value={ocrModel}
          onChangeText={setOcrModel}
          placeholder="deepseek-ai/DeepSeek-OCR"
          placeholderTextColor={theme.placeholder}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Text style={styles.fieldLabel}>API Key</Text>
        <TextInput
          style={styles.input}
          value={ocrKey}
          onChangeText={setOcrKey}
          placeholder="sk-…（可复用硅基流动的 key）"
          placeholderTextColor={theme.placeholder}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Pressable style={styles.saveBtn} onPress={saveOcr}>
          <Text style={styles.saveText}>{ocrSaved ? '已保存 ✓' : '保存 OCR 配置'}</Text>
        </Pressable>

        <Text style={styles.section}>联网搜索（Tavily）</Text>
        <Text style={styles.ocrHint}>
          开启后，模型可在需要时联网搜索最新信息。在 https://tavily.com 注册获取 API Key。
        </Text>
        <Text style={styles.fieldLabel}>Tavily API Key</Text>
        <TextInput
          style={styles.input}
          value={tavilyKey}
          onChangeText={setTavilyKey}
          placeholder="tvly-…"
          placeholderTextColor={theme.placeholder}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Pressable style={styles.saveBtn} onPress={saveTavily}>
          <Text style={styles.saveText}>{tavilySaved ? '已保存 ✓' : '保存 Tavily 配置'}</Text>
        </Pressable>

        <Text style={styles.section}>文档解析（LlamaParse）</Text>
        <Text style={styles.ocrHint}>
          用于解析 PDF / Word / PPT / Excel 等文档。在 https://cloud.llamaindex.ai 注册获取 API Key（llx-…）。
        </Text>
        <Text style={styles.fieldLabel}>LlamaParse API Key</Text>
        <TextInput
          style={styles.input}
          value={llamaParseKey}
          onChangeText={setLlamaParseKey}
          placeholder="llx-…"
          placeholderTextColor={theme.placeholder}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Pressable style={styles.saveBtn} onPress={saveLlamaParse}>
          <Text style={styles.saveText}>{llamaParseSaved ? '已保存 ✓' : '保存 LlamaParse 配置'}</Text>
        </Pressable>

        <Text style={styles.section}>全局系统提示词（可选）</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={sp}
          onChangeText={setSp}
          placeholder="例如：你是一个简洁的中文助手"
          placeholderTextColor={theme.placeholder}
          multiline
        />
        <Pressable style={styles.saveBtn} onPress={saveGlobal}>
          <Text style={styles.saveText}>{saved ? '已保存 ✓' : '保存提示词'}</Text>
        </Pressable>
      </ScrollView>
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
    headerBtn: { fontSize: 14, color: theme.primary },
    content: { padding: 16, paddingBottom: 48 },
    section: { fontSize: 13, color: theme.textTertiary, marginTop: 20, marginBottom: 8 },
    // 主题切换分段控件
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
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 14,
      paddingHorizontal: 14,
      borderWidth: 1,
      borderColor: theme.borderLight,
      borderRadius: 10,
      marginBottom: 8,
    },
    rowName: { fontSize: 15, fontWeight: '600', color: theme.textPrimary },
    rowSub: { fontSize: 12, color: theme.textTertiary, marginTop: 2 },
    chev: { fontSize: 22, color: theme.textTertiary, marginLeft: 8 },
    addProvider: {
      borderWidth: 1,
      borderColor: theme.primary,
      borderStyle: 'dashed',
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: 'center',
      marginTop: 4,
    },
    addProviderText: { color: theme.primary, fontWeight: '600', fontSize: 15 },
    ocrHint: { fontSize: 12, color: theme.textTertiary, marginBottom: 8, lineHeight: 17 },
    fieldLabel: { fontSize: 13, fontWeight: '600', marginTop: 12, marginBottom: 6, color: theme.textPrimary },
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
    multiline: { minHeight: 80, textAlignVertical: 'top' },
    saveBtn: {
      backgroundColor: theme.primary,
      borderRadius: 10,
      paddingVertical: 14,
      alignItems: 'center',
      marginTop: 16,
    },
    saveText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  });
}
