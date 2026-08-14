// 全局设置存取 —— 设置存 SQLite 的 kv 表，各服务商的 API key 存 SecureStore
import { getDB } from './db';
import { platform } from './platform';
import type { AppSettings, Provider } from './types';
import { SILICONFLOW_BASE_URL } from './providers/siliconflow';

const SETTINGS_KEY = 'app_settings';

// 种子服务商：填好 key 即可用
const SEED_PROVIDERS: Provider[] = [
  {
    id: 'siliconflow',
    name: '硅基流动',
    type: 'openai',
    baseURL: SILICONFLOW_BASE_URL,
    models: [
      'deepseek-ai/DeepSeek-V3',
      'deepseek-ai/DeepSeek-R1',
      'Qwen/Qwen2.5-72B-Instruct',
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek 官方',
    type: 'openai',
    baseURL: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    type: 'openai',
    baseURL: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini'],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    type: 'anthropic',
    baseURL: 'https://api.anthropic.com',
    models: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'],
  },
];

export const DEFAULT_SETTINGS: AppSettings = {
  providers: SEED_PROVIDERS,
  currentProviderId: 'siliconflow',
  currentModel: 'deepseek-ai/DeepSeek-V3',
  temperature: 0.7,
  topP: 1,
  maxTokens: 4096,
  systemPrompt: '',
  autoTitleMode: 'local',
  modelContextWindows: {},
  ocr: { baseURL: SILICONFLOW_BASE_URL, model: 'deepseek-ai/DeepSeek-OCR' },
  documentParser: {
    provider: 'llamaparse',
  },
  tavilySearchDepth: 'basic',
  webSearchProvider: 'tavily',
  theme: 'system',
};

const DEFAULT_OCR = { baseURL: SILICONFLOW_BASE_URL, model: 'deepseek-ai/DeepSeek-OCR' };
async function ensureKvTable() {
  const db = await getDB();
  await db.execAsync(
    'CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);'
  );
}

export async function loadSettings(): Promise<AppSettings> {
  await ensureKvTable();
  const db = await getDB();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM kv WHERE key = ?',
    SETTINGS_KEY
  );
  if (!row) {
    // 首次启动：尝试迁移旧版（单服务商）配置
    return migrateLegacy();
  }
  try {
    const parsed = JSON.parse(row.value);
    // 旧结构（有 defaultModel/baseURL，无 providers）→ 迁移
    if (!parsed.providers) return migrateFromOldShape(parsed);
    return normalizeSettings(parsed);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

// 规整：保证至少一个服务商、当前服务商/模型有效
function normalizeSettings(s: any): AppSettings {
  const providers: Provider[] = Array.isArray(s.providers) && s.providers.length
    ? s.providers
    : SEED_PROVIDERS;
  let cur = providers.find((p) => p.id === s.currentProviderId) ?? providers[0];
  let model = cur.models.includes(s.currentModel)
    ? s.currentModel
    : cur.models[0] ?? '';
  return {
    providers,
    currentProviderId: cur.id,
    currentModel: model,
    temperature: normalizeNumber(s.temperature, 0.7, 0, 2),
    topP: normalizeNumber(s.topP ?? s.top_p, 1, 0, 1),
    maxTokens: s.maxTokens ?? 4096,
    systemPrompt: s.systemPrompt ?? '',
    autoTitleMode: s.autoTitleMode === 'ai' ? 'ai' : 'local',
    modelContextWindows: normalizeModelContextWindows(s.modelContextWindows),
    ocr: s.ocr?.baseURL ? s.ocr : DEFAULT_OCR,
    documentParser: normalizeDocumentParser(s.documentParser),
    tavilySearchDepth: s.tavilySearchDepth === 'advanced' ? 'advanced' : 'basic',
    webSearchProvider: s.webSearchProvider === 'bocha' ? 'bocha' : 'tavily',
    theme: s.theme ?? 'system',
  };
}

function normalizeModelContextWindows(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, raw]) => [key, Number(raw)] as const)
      .filter(([, parsed]) => Number.isInteger(parsed) && parsed >= 2_048 && parsed <= 2_000_000)
  );
}

function normalizeNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeDocumentParser(s: any): AppSettings['documentParser'] {
  // 旧版本可能保存了其他解析器配置，移动端统一使用本地优先 + LlamaParse 回退。
  return { provider: 'llamaparse' };
}

// 旧结构 { baseURL, models[], defaultModel } → 新多服务商结构
function migrateFromOldShape(old: any): AppSettings {
  const models: string[] =
    Array.isArray(old.models) && old.models.length
      ? old.models
      : [old?.defaultModel?.model].filter(Boolean);
  const sf: Provider = {
    id: 'siliconflow',
    name: '硅基流动',
    type: 'openai',
    baseURL: old.baseURL || SILICONFLOW_BASE_URL,
    models: models.length ? models : SEED_PROVIDERS[0].models,
  };
  // 旧 key 存在 chatbox_siliconflow_api_key，迁移到新 key 名（同名，无需搬动）
  const providers = [sf, ...SEED_PROVIDERS.filter((p) => p.id !== 'siliconflow')];
  return normalizeSettings({
    providers,
    currentProviderId: 'siliconflow',
    currentModel: old?.defaultModel?.model || sf.models[0],
    temperature: old?.defaultModel?.temperature ?? 0.7,
    topP: old?.defaultModel?.topP ?? old?.defaultModel?.top_p ?? 1,
    maxTokens: old?.defaultModel?.maxTokens ?? 4096,
    systemPrompt: old?.defaultModel?.systemPrompt ?? '',
  });
}

// 全新安装（无任何旧配置）
async function migrateLegacy(): Promise<AppSettings> {
  return DEFAULT_SETTINGS;
}

export async function saveSettings(s: AppSettings): Promise<void> {
  await ensureKvTable();
  const db = await getDB();
  await db.runAsync(
    'INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)',
    SETTINGS_KEY,
    JSON.stringify(s)
  );
}

// ---- 按服务商存取 API Key（SecureStore）----
// 旧版用的是 'siliconflow_api_key'，新版统一为 'provider_key_<id>'；
// 对 siliconflow 做兼容读取，避免丢失已填的 key。
function keyName(providerId: string): string {
  return `provider_key_${providerId}`;
}

export async function getProviderKey(providerId: string): Promise<string | null> {
  const v = await platform.getSecret(keyName(providerId));
  if (v) return v;
  // 兼容旧 key 名
  if (providerId === 'siliconflow') {
    return platform.getSecret('siliconflow_api_key');
  }
  return null;
}

export async function setProviderKey(
  providerId: string,
  key: string
): Promise<void> {
  await platform.setSecret(keyName(providerId), key.trim());
}

export async function deleteProviderKey(providerId: string): Promise<void> {
  await platform.deleteSecret(keyName(providerId));
  if (providerId === 'siliconflow') {
    await platform.deleteSecret('siliconflow_api_key');
  }
}

// ---- OCR 的 key（复用 per-provider 机制，id 固定 'ocr'）----
export async function getOcrKey(): Promise<string | null> {
  return getProviderKey('ocr');
}

export async function setOcrKey(key: string): Promise<void> {
  return setProviderKey('ocr', key);
}

export async function deleteOcrKey(): Promise<void> {
  return deleteProviderKey('ocr');
}

// ---- Tavily 联网搜索的 key（同样复用 per-provider 机制，id 固定 'tavily'）----
export async function getTavilyKey(): Promise<string | null> {
  return getProviderKey('tavily');
}

export async function setTavilyKey(key: string): Promise<void> {
  return setProviderKey('tavily', key);
}

export async function deleteTavilyKey(): Promise<void> {
  return deleteProviderKey('tavily');
}

// ---- Bocha 联网搜索的 key（复用 per-provider 机制，id 固定 'bocha'）----
export async function getBochaKey(): Promise<string | null> {
  return getProviderKey('bocha');
}

export async function setBochaKey(key: string): Promise<void> {
  return setProviderKey('bocha', key);
}

export async function deleteBochaKey(): Promise<void> {
  return deleteProviderKey('bocha');
}

// ---- LlamaParse 文档解析的 key（复用 per-provider 机制，id 固定 'llamaparse'）----
export async function getLlamaParseKey(): Promise<string | null> {
  return getProviderKey('llamaparse');
}

export async function setLlamaParseKey(key: string): Promise<void> {
  return setProviderKey('llamaparse', key);
}

export async function deleteLlamaParseKey(): Promise<void> {
  return deleteProviderKey('llamaparse');
}

