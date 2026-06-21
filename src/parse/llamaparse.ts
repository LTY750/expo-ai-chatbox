// LlamaParse 文档解析 —— 支持 PDF / Word / PPT / Excel 等
// 流程：上传文件(multipart) → 创建解析任务 → 轮询状态 → 取 markdown
// API 文档：https://developers.llamaindex.ai/llamaparse/parse/getting_started/
import { fetch as expoFetch } from 'expo/fetch';
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
  // RN 的 FormData 接受 {uri, name, type} 作为文件
  fd.append('file', {
    uri: f.uri,
    name: f.name,
    type: f.mimeType || 'application/octet-stream',
  } as any);

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
  const res = await expoFetch(`${BASE}/api/parsing/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      file_id: fileId,
      parse_config: { result_type: 'markdown' },
    }),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LlamaParse 创建任务失败 HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = await res.json();
  const id = json?.id ?? json?.job_id;
  if (typeof id !== 'string') throw new Error('LlamaParse 创建任务响应缺少 job id');
  return id;
}

// 轮询任务状态，完成后返回 markdown
async function pollResult(jobId: string, apiKey: string, signal?: AbortSignal): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < POLL_MAX_MS) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    await sleep(POLL_INTERVAL_MS);
    const res = await expoFetch(`${BASE}/api/parsing/job/${jobId}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`LlamaParse 轮询失败 HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    const json = await res.json();
    const status = json?.status;
    if (status === 'SUCCESS' || status === 'COMPLETED') {
      // 取结果（markdown）
      return extractMarkdown(json) ?? (await fetchResultMarkdown(jobId, apiKey, signal));
    }
    if (status === 'ERROR' || status === 'FAILED') {
      throw new Error(`LlamaParse 解析失败：${JSON.stringify(json?.error ?? json).slice(0, 300)}`);
    }
    // PENDING / PROCESSING 继续轮询
  }
  throw new Error('LlamaParse 解析超时（超过 2 分钟）');
}

// 从轮询响应里尝试直接取 markdown（部分版本内联返回）
function extractMarkdown(json: any): string | null {
  if (typeof json?.markdown === 'string' && json.markdown) return json.markdown;
  const md = json?.result?.markdown;
  if (typeof md === 'string' && md) return md;
  return null;
}

// 显式拉取结果 markdown
async function fetchResultMarkdown(jobId: string, apiKey: string, signal?: AbortSignal): Promise<string> {
  const res = await expoFetch(`${BASE}/api/parsing/job/${jobId}/result?format=markdown`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LlamaParse 取结果失败 HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = await res.json();
  // 结果格式可能是 { markdown: "..." } 或 { result: { markdown } }
  return extractMarkdown(json) ?? json?.result ?? '';
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
  const jobId = await createParseJob(fileId, config.apiKey, signal);
  const md = await pollResult(jobId, config.apiKey, signal);
  return md;
}
