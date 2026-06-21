// Tavily 联网搜索 —— https://api.tavily.com/search
// 返回结果格式化成模型易读的文本块
import { fetch as expoFetch } from 'expo/fetch';

const TAVILY_ENDPOINT = 'https://api.tavily.com/search';
const RESULT_CONTENT_MAX = 500; // 每条结果正文截断字数，防撑爆上下文

export interface TavilyResult {
  answer?: string; // Tavily 自带的总结答案
  results: Array<{
    title: string;
    url: string;
    content: string;
  }>;
}

export async function tavilySearch(
  apiKey: string,
  query: string,
  opts?: { maxResults?: number; signal?: AbortSignal }
): Promise<TavilyResult> {
  const maxResults = opts?.maxResults ?? 5;
  // 用外部 signal 与 15s 超时 signal 合并：任一触发即中止
  const timeoutSignal = AbortSignal.timeout(15000);
  const signal = opts?.signal
    ? AbortSignal.any([opts.signal, timeoutSignal])
    : timeoutSignal;

  const res = await expoFetch(TAVILY_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      search_depth: 'advanced',
      include_answer: true,
      max_results: maxResults,
    }),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Tavily HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = await res.json();
  return {
    answer: typeof json?.answer === 'string' ? json.answer : undefined,
    results: Array.isArray(json?.results)
      ? json.results.map((r: any) => ({
          title: String(r?.title ?? ''),
          url: String(r?.url ?? ''),
          content: String(r?.content ?? ''),
        }))
      : [],
  };
}

// 把搜索结果拼成模型可读的文本（每条正文截断，控制 token）
export function formatTavilyResult(r: TavilyResult, query: string): string {
  const parts: string[] = [`搜索查询：${query}`];
  if (r.answer) parts.push(`摘要：${r.answer}`);
  if (r.results.length) {
    parts.push('来源：');
    r.results.forEach((item, i) => {
      const content =
        item.content.length > RESULT_CONTENT_MAX
          ? item.content.slice(0, RESULT_CONTENT_MAX) + '…'
          : item.content;
      parts.push(`[${i + 1}] ${item.title}\nURL: ${item.url}\n${content}`);
    });
  }
  return parts.join('\n\n');
}
