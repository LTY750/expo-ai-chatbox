// 设置页（一级）—— 服务商列表 + 添加服务商 + 全局参数 + 文档解析(OCR)
import { useEffect, useState } from 'react';
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
import ProviderDetailScreen from './ProviderDetailScreen';

export default function SettingsScreen({ onClose }: { onClose: () => void }) {
  const providers = useChatStore((s) => s.settings.providers);
  const systemPrompt = useChatStore((s) => s.settings.systemPrompt);
  const ocr = useChatStore((s) => s.settings.ocr);
  const updateSettings = useChatStore((s) => s.updateSettings);
  const updateOcr = useChatStore((s) => s.updateOcr);
  const saveOcrKey = useChatStore((s) => s.saveOcrKey);
  const saveTavilyKey = useChatStore((s) => s.saveTavilyKey);
  const saveLlamaParseKey = useChatStore((s) => s.saveLlamaParseKey);

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
          placeholderTextColor="#999"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Text style={styles.fieldLabel}>OCR 模型</Text>
        <TextInput
          style={styles.input}
          value={ocrModel}
          onChangeText={setOcrModel}
          placeholder="deepseek-ai/DeepSeek-OCR"
          placeholderTextColor="#999"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Text style={styles.fieldLabel}>API Key</Text>
        <TextInput
          style={styles.input}
          value={ocrKey}
          onChangeText={setOcrKey}
          placeholder="sk-…（可复用硅基流动的 key）"
          placeholderTextColor="#999"
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
          placeholderTextColor="#999"
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
          placeholderTextColor="#999"
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
          placeholderTextColor="#999"
          multiline
        />
        <Pressable style={styles.saveBtn} onPress={saveGlobal}>
          <Text style={styles.saveText}>{saved ? '已保存 ✓' : '保存提示词'}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

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
  section: { fontSize: 13, color: '#999', marginTop: 20, marginBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 10,
    marginBottom: 8,
  },
  rowName: { fontSize: 15, fontWeight: '600', color: '#222' },
  rowSub: { fontSize: 12, color: '#999', marginTop: 2 },
  chev: { fontSize: 22, color: '#ccc', marginLeft: 8 },
  addProvider: {
    borderWidth: 1,
    borderColor: '#2563eb',
    borderStyle: 'dashed',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  addProviderText: { color: '#2563eb', fontWeight: '600', fontSize: 15 },
  ocrHint: { fontSize: 12, color: '#999', marginBottom: 8, lineHeight: 17 },
  fieldLabel: { fontSize: 13, fontWeight: '600', marginTop: 12, marginBottom: 6, color: '#444' },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  saveBtn: {
    backgroundColor: '#2563eb',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  saveText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
