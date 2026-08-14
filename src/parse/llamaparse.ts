// LlamaParse 文档解析 —— 支持 PDF / Word / PPT / Excel 等
// 流程：上传文件(multipart) → 创建解析任务 → 轮询状态 → 取 markdown
// API 文档：https://developers.llamaindex.ai/llamaparse/parse/getting_started/
import { fetch as expoFetch } from 'expo/fetch';
import { File } from 'expo-file-system';
import type { PickedFile } from './index';

const BASE = 'https://api.cloud.llamaindex.ai';
const POLL_INTERVAL_MS = 1500;
const POLL_MAX_MS = 120000; // 最多轮询 2 分钟

export interface LlamaParseConfig {
  apiKey: string;
}

// 上传文件，返回 file_id
async function uploadFile(f: PickedFile, apiKey: string, signal?: AbortSignal): Promise<string> {
  const fd = new FormData();
  fd.append('purpose', 'parse');
  // Expo SDK 56 的 expo/fetch multipart 转换器支持 File/Blob；直接传
  // `{ uri }` 会在原生环境被识别为不支持的 FormData part。
  const file = new File(f.uri);
  fd.append('file', file, f.name);

  const res = await expoFetch(`${BASE}/api/v1/beta/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: fd,
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LlamaParse 上传失败 HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = await res.json();
  const id = json?.id;
  if (typeof id !== 'string') throw new Error('LlamaParse 上传响应缺少 file id');
  return id;
}

// 创建解析任务，返回 job_id
async function createParseJob(fileId: string, apiKey: string, signal?: AbortSignal): Promise<string> {
  const res = await expoFetch(`${BASE}/api/v2/parse`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      file_id: fileId,
      tier: 'cost_effective',
      version: 'latest',
    }),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LlamaParse 创建任务失败 HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = await res.json();
  const id = json?.id ?? json?.job_id ?? json?.job?.id;
  if (typeof id !== 'string') throw new Error('LlamaParse 创建任务响应缺少 job id');
  return id;
}

// 轮询任务状态，完成后返回 markdown
async function pollResult(jobId: string, apiKey: string, signal?: AbortSignal): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < POLL_MAX_MS) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    await sleep(POLL_INTERVAL_MS);
    const res = await expoFetch(`${BASE}/api/v2/parse/${encodeURIComponent(jobId)}?expand=markdown`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`LlamaParse 轮询失败 HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    const json = await res.json();
    // v2 的查询响应把任务字段放在 job 下；兼容可能存在的顶层旧格式。
    const status = String(json?.job?.status ?? json?.status ?? '').toUpperCase();
    if (status === 'SUCCESS' || status === 'COMPLETED') {
      const markdown = extractMarkdown(json);
      if (markdown) return markdown;
      throw new Error('LlamaParse 已完成，但响应中没有 Markdown 结果');
    }
    if (status === 'ERROR' || status === 'FAILED' || status === 'CANCELLED') {
      throw new Error(
        `LlamaParse 解析失败：${String(json?.job?.error_message ?? json?.error_message ?? json?.error ?? status).slice(0, 300)}`
      );
    }
    // PENDING / PROCESSING 继续轮询
  }
  throw new Error('LlamaParse 解析超时（超过 2 分钟）');
}

// 从轮询响应里尝试直接取 markdown（部分版本内联返回）
function extractMarkdown(json: any): string | null {
  if (typeof json?.markdown_full === 'string' && json.markdown_full) return json.markdown_full;
  if (typeof json?.markdown === 'string' && json.markdown) return json.markdown;
  const pages = json?.markdown?.pages;
  if (Array.isArray(pages)) {
    const markdown = pages
      .map((page: any) => (typeof page?.markdown === 'string' ? page.markdown : ''))
      .filter(Boolean)
      .join('\n\n');
    if (markdown) return markdown;
  }
  const md = json?.result?.markdown;
  if (typeof md === 'string' && md) return md;
  if (typeof json?.text_full === 'string' && json.text_full) return json.text_full;
  const textPages = json?.text?.pages;
  if (Array.isArray(textPages)) {
    const text = textPages
      .map((page: any) => (typeof page?.text === 'string' ? page.text : ''))
      .filter(Boolean)
      .join('\n\n');
    if (text) return text;
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// 主入口：上传 → 解析 → 轮询 → 返回 markdown 文本
export async function parseDocument(
  f: PickedFile,
  config: LlamaParseConfig,
  signal?: AbortSignal
): Promise<string> {
  const fileId = await uploadFile(f, config.apiKey, signal);
  try {
    const jobId = await createParseJob(fileId, config.apiKey, signal);
    return await pollResult(jobId, config.apiKey, signal);
  } finally {
    // 解析完成或失败后删除云端临时文件，避免长期占用账户存储。
    await expoFetch(`${BASE}/api/v1/beta/files/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${config.apiKey}` },
    }).catch(() => undefined);
  }
}
