// Bocha 联网搜索 —— https://open.bochaai.com/
// 只使用 JSON HTTP API，兼容 Expo 原生环境。
import { fetch as expoFetch } from 'expo/fetch';

const BOCHA_ENDPOINT = 'https://api.bocha.cn/v1/web-search';
const REQUEST_TIMEOUT_MS = 15000;
const RESULT_CONTENT_MAX = 500;

export interface SearchResult {
  results: Array<{ title: string; url: string; content: string }>;
}

interface BochaResponse {
  code?: number | string;
  msg?: string;
  message?: string;
  data?: { webPages?: { value?: Array<{ name?: string; url?: string; summary?: string; snippet?: string }> } };
  webPages?: { value?: Array<{ name?: string; url?: string; summary?: string; snippet?: string }> };
}

export async function bochaSearch(
  apiKey: string,
  query: string,
  opts?: { signal?: AbortSignal; maxResults?: number }
): Promise<SearchResult> {
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = opts?.signal
    ? AbortSignal.any([opts.signal, timeoutSignal])
    : timeoutSignal;
  const res = await expoFetch(BOCHA_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      query,
      freshness: 'noLimit',
      summary: true,
      count: opts?.maxResults ?? 5,
    }),
    signal,
  });
  const body = await res.text().catch(() => '');
  if (!res.ok) {
    throw new Error(`Bocha HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  let json: BochaResponse;
  try {
    json = body ? JSON.parse(body) : {};
  } catch {
    throw new Error('Bocha 返回了无效 JSON');
  }
  const code = json.code == null ? 200 : Number(json.code);
  if (!Number.isNaN(code) && code !== 200) {
    throw new Error(json.msg || json.message || `Bocha API error: ${json.code}`);
  }
  const values = json.data?.webPages?.value ?? json.webPages?.value;
  if (!Array.isArray(values)) {
    throw new Error('Bocha 返回格式不包含 webPages.value');
  }
  return {
    results: values.map((item) => ({
      title: String(item.name ?? ''),
      url: String(item.url ?? ''),
      content: String(item.summary ?? item.snippet ?? ''),
    })),
  };
}

export function formatSearchResult(result: SearchResult, query: string): string {
  const parts: string[] = [`搜索查询：${query}`];
  if (result.results.length) {
    parts.push('来源：');
    result.results.forEach((item, index) => {
      const content = item.content.length > RESULT_CONTENT_MAX
        ? `${item.content.slice(0, RESULT_CONTENT_MAX)}…`
        : item.content;
      parts.push(`[${index + 1}] ${item.title}\nURL: ${item.url}\n${content}`);
    });
  }
  return parts.join('\n\n');
}
