// 阿里云文档解析（大模型版）
// API 形态：SubmitDocParserJob 上传 → QueryDocParserStatus 轮询 → GetDocParserResult 拉 markdown
import { fetch as expoFetch } from 'expo/fetch';
import { File } from 'expo-file-system';
import type { PickedFile } from './index';

const API_VERSION = '2022-07-11';
const POLL_INTERVAL_MS = 1800;
const POLL_MAX_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 2 * 60 * 1000;
const DELETE_TIMEOUT_MS = 30 * 1000;
const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;

export interface AliyunDocParserConfig {
  accessKeyId: string;
  accessKeySecret: string;
  endpoint: string;
  llmEnhancement: boolean;
  enhancementMode?: '' | 'VLM';
  oss: {
    bucket: string;
    endpoint: string;
    region: string;
    prefix: string;
    urlExpiresSeconds: number;
  };
}

interface AliyunRequest {
  endpoint: string;
  accessKeyId: string;
  accessKeySecret: string;
  action: string;
  body: Record<string, any>;
  file?: { uri: string; name: string; mimeType: string; size?: number };
  signal?: AbortSignal;
}

function normalizeEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim() || 'docmind-api.cn-hangzhou.aliyuncs.com';
  return trimmed.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

async function runWithTimeout<T>(
  action: (signal: AbortSignal) => Promise<T>,
  parentSignal?: AbortSignal,
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = () => controller.abort();
  if (parentSignal?.aborted) controller.abort();
  else parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await action(controller.signal);
  } catch (error) {
    if (timedOut) {
      throw new Error(`阿里云网络请求超时（超过 ${Math.round(timeoutMs / 1000)} 秒）`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', abortFromParent);
  }
}

function checkedFile(f: PickedFile): File {
  const size = f.size;
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) {
    throw new Error('无法安全获取文件大小，请先把云端文件下载到本机后重新选择');
  }
  if (size > MAX_UPLOAD_BYTES) {
    throw new Error('文件过大：阿里云文档解析当前最多支持 32 MB，请压缩或拆分后重试');
  }
  return new File(f.uri);
}

function sha256Hex(text: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(text)));
}

function sha256BytesHex(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}

function hmacBytes(key: Uint8Array | string, text: string): Uint8Array {
  const rawKey = typeof key === 'string' ? new TextEncoder().encode(key) : key;
  return hmacSha256(rawKey, new TextEncoder().encode(text));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function randomHex(bytes = 16): string {
  const arr = new Uint8Array(bytes);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  return bytesToHex(arr);
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

function sha256(input: Uint8Array): Uint8Array {
  const bitLen = input.length * 8;
  const withOne = input.length + 1;
  const paddedLen = Math.ceil((withOne + 8) / 64) * 64;
  const bytes = new Uint8Array(paddedLen);
  bytes.set(input);
  bytes[input.length] = 0x80;
  const view = new DataView(bytes.buffer);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let i = 0; i < bytes.length; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(i + t * 4, false);
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let t = 0; t < 64; t++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + K[t] + w[t]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  [h0, h1, h2, h3, h4, h5, h6, h7].forEach((h, i) => outView.setUint32(i * 4, h, false));
  return out;
}

function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  const block = 64;
  let k = key.length > block ? sha256(key) : key;
  const oKey = new Uint8Array(block);
  const iKey = new Uint8Array(block);
  oKey.set(k);
  iKey.set(k);
  for (let i = 0; i < block; i++) {
    oKey[i] ^= 0x5c;
    iKey[i] ^= 0x36;
  }
  const inner = new Uint8Array(block + message.length);
  inner.set(iKey);
  inner.set(message, block);
  const innerHash = sha256(inner);
  const outer = new Uint8Array(block + innerHash.length);
  outer.set(oKey);
  outer.set(innerHash, block);
  return sha256(outer);
}

function canonicalHeaders(headers: Record<string, string>): {
  signedHeaders: string;
  canonical: string;
} {
  const keys = Object.keys(headers).map((k) => k.toLowerCase()).sort();
  const canonical = keys.map((k) => `${k}:${headers[k].trim()}\n`).join('');
  return { signedHeaders: keys.join(';'), canonical };
}

async function authHeaders(
  req: Omit<AliyunRequest, 'body' | 'file' | 'signal'>,
  payloadHash: string,
  contentType?: string
): Promise<Record<string, string>> {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const date = now.slice(0, 10);
  const host = normalizeEndpoint(req.endpoint);
  const headers: Record<string, string> = {
    host,
    'x-acs-action': req.action,
    'x-acs-content-sha256': payloadHash,
    'x-acs-date': now,
    'x-acs-signature-nonce': randomHex(),
    'x-acs-version': API_VERSION,
  };
  const { signedHeaders, canonical } = canonicalHeaders(headers);
  const canonicalRequest = [
    'POST',
    '/',
    '',
    canonical,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const hashedCanonicalRequest = sha256Hex(canonicalRequest);
  const stringToSign = ['ACS3-HMAC-SHA256', hashedCanonicalRequest].join('\n');
  const signature = bytesToHex(hmacBytes(req.accessKeySecret, stringToSign));
  const { host: _host, ...requestHeaders } = headers;
  const out: Record<string, string> = {
    ...requestHeaders,
    authorization:
      `ACS3-HMAC-SHA256 Credential=${req.accessKeyId},` +
      `SignedHeaders=${signedHeaders},Signature=${signature}`,
  };
  if (contentType) out['content-type'] = contentType;
  return out;
}

async function callAliyun(req: AliyunRequest): Promise<any> {
  const endpoint = normalizeEndpoint(req.endpoint);
  let body: BodyInit | Uint8Array;
  let contentType: string | undefined;
  let payloadHash: string;

  if (req.file) {
    const built = await buildMultipartBody(req.body, req.file);
    body = built.body;
    contentType = built.contentType;
    payloadHash = sha256BytesHex(built.body);
  } else {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(req.body)) {
      if (value !== undefined && value !== null) params.append(key, String(value));
    }
    const text = params.toString();
    body = text;
    contentType = 'application/x-www-form-urlencoded';
    payloadHash = sha256Hex(text);
  }

  const headers = await authHeaders(req, payloadHash, contentType);
  const { res, text } = await runWithTimeout(async (signal) => {
    const res = await expoFetch(`https://${endpoint}/`, {
      method: 'POST',
      headers,
      body: body as any,
      signal,
    });
    return { res, text: await res.text() };
  }, req.signal);
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  const responseCode = json?.Code ?? json?.code;
  const normalizedCode = responseCode == null ? '' : String(responseCode).toLowerCase();
  const businessFailed =
    !!normalizedCode && !['0', '200', 'ok', 'success'].includes(normalizedCode);
  if (!res.ok || businessFailed) {
    const msg = json?.Message || json?.message || text || `HTTP ${res.status}`;
    throw new Error(`阿里云文档解析失败：${msg}`);
  }
  return json;
}

function hmacSha1Base64(key: string, text: string): string {
  return bytesToBase64(hmacSha1(new TextEncoder().encode(key), new TextEncoder().encode(text)));
}

function bytesToBase64(bytes: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += chars[a >> 2];
    out += chars[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += i + 1 < bytes.length ? chars[((b & 15) << 2) | ((c ?? 0) >> 6)] : '=';
    out += i + 2 < bytes.length ? chars[c & 63] : '=';
  }
  return out;
}

function sha1(input: Uint8Array): Uint8Array {
  const bitLen = input.length * 8;
  const paddedLen = Math.ceil((input.length + 1 + 8) / 64) * 64;
  const bytes = new Uint8Array(paddedLen);
  bytes.set(input);
  bytes[input.length] = 0x80;
  const view = new DataView(bytes.buffer);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);
  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let i = 0; i < bytes.length; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(i + t * 4, false);
    for (let t = 16; t < 80; t++) w[t] = ((w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16]) << 1) | ((w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16]) >>> 31);
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let t = 0; t < 80; t++) {
      let f = 0;
      let k = 0;
      if (t < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (t < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (t < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[t]) >>> 0;
      e = d;
      d = c;
      c = ((b << 30) | (b >>> 2)) >>> 0;
      b = a;
      a = temp;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }
  const out = new Uint8Array(20);
  const outView = new DataView(out.buffer);
  [h0, h1, h2, h3, h4].forEach((h, i) => outView.setUint32(i * 4, h, false));
  return out;
}

function hmacSha1(key: Uint8Array, message: Uint8Array): Uint8Array {
  const block = 64;
  let k = key.length > block ? sha1(key) : key;
  const oKey = new Uint8Array(block);
  const iKey = new Uint8Array(block);
  oKey.set(k);
  iKey.set(k);
  for (let i = 0; i < block; i++) {
    oKey[i] ^= 0x5c;
    iKey[i] ^= 0x36;
  }
  const inner = new Uint8Array(block + message.length);
  inner.set(iKey);
  inner.set(message, block);
  const innerHash = sha1(inner);
  const outer = new Uint8Array(block + innerHash.length);
  outer.set(oKey);
  outer.set(innerHash, block);
  return sha1(outer);
}

function normalizeObjectKey(prefix: string, name: string): string {
  const cleanPrefix = (prefix || 'chatbox-docs/').replace(/^\/+/, '').replace(/\/?$/, '/');
  const safeName = name.replace(/[^\w.\-\u4e00-\u9fa5]+/g, '_');
  return `${cleanPrefix}${Date.now()}-${randomHex(6)}-${safeName}`;
}

function ossHost(config: AliyunDocParserConfig): string {
  const endpoint = config.oss.endpoint.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return `${config.oss.bucket}.${endpoint}`;
}

function ossResource(config: AliyunDocParserConfig, objectKey: string): string {
  return `/${config.oss.bucket}/${objectKey}`;
}

function ossDate(): string {
  return new Date().toUTCString();
}

function ossAuth(
  config: AliyunDocParserConfig,
  method: string,
  objectKey: string,
  contentType = '',
  date = ossDate()
): string {
  const canonical = [method, '', contentType, date, ossResource(config, objectKey)].join('\n');
  return `OSS ${config.accessKeyId}:${hmacSha1Base64(config.accessKeySecret, canonical)}`;
}

async function uploadToOss(
  f: PickedFile,
  config: AliyunDocParserConfig,
  signal?: AbortSignal
): Promise<{ objectKey: string; url: string }> {
  if (!config.oss.bucket.trim()) throw new Error('请先配置 OSS Bucket 名称');
  const objectKey = normalizeObjectKey(config.oss.prefix, f.name);
  const mime = f.mimeType || 'application/octet-stream';
  const bytes = await checkedFile(f).bytes();
  const date = ossDate();
  const host = ossHost(config);
  const { res, errorText } = await runWithTimeout(async (requestSignal) => {
    const res = await expoFetch(`https://${host}/${encodeOssPath(objectKey)}`, {
      method: 'PUT',
      headers: {
        Date: date,
        'Content-Type': mime,
        Authorization: ossAuth(config, 'PUT', objectKey, mime, date),
      },
      body: bytes as any,
      signal: requestSignal,
    });
    return { res, errorText: res.ok ? '' : await res.text() };
  }, signal);
  if (!res.ok) {
    throw new Error(`OSS 上传失败 HTTP ${res.status}: ${errorText.slice(0, 300)}`);
  }
  return { objectKey, url: signedOssUrl(config, objectKey) };
}

function signedOssUrl(config: AliyunDocParserConfig, objectKey: string): string {
  const host = ossHost(config);
  const expires = Math.floor(Date.now() / 1000) + Math.max(config.oss.urlExpiresSeconds || 600, 60);
  const canonical = ['GET', '', '', String(expires), ossResource(config, objectKey)].join('\n');
  const signature = encodeURIComponent(hmacSha1Base64(config.accessKeySecret, canonical));
  return `https://${host}/${encodeOssPath(objectKey)}?OSSAccessKeyId=${encodeURIComponent(config.accessKeyId)}&Expires=${expires}&Signature=${signature}`;
}

async function deleteOssObject(
  config: AliyunDocParserConfig,
  objectKey: string,
  signal?: AbortSignal
): Promise<void> {
  const date = ossDate();
  const host = ossHost(config);
  await runWithTimeout(async (requestSignal) => {
    const res = await expoFetch(`https://${host}/${encodeOssPath(objectKey)}`, {
      method: 'DELETE',
      headers: {
        Date: date,
        Authorization: ossAuth(config, 'DELETE', objectKey, '', date),
      },
      signal: requestSignal,
    });
    await res.text();
  }, signal, DELETE_TIMEOUT_MS).catch(() => {});
}

function encodeOssPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

async function buildMultipartBody(
  fields: Record<string, any>,
  file: { uri: string; name: string; mimeType: string; size?: number }
): Promise<{ body: Uint8Array; contentType: string }> {
  const boundary = `----chatbox-${randomHex(12)}`;
  const parts: Uint8Array[] = [];
  const enc = new TextEncoder();
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    parts.push(
      enc.encode(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${escapeMultipart(key)}"\r\n\r\n` +
          `${String(value)}\r\n`
      )
    );
  }
  const fileBytes = await checkedFile(file).bytes();
  parts.push(
    enc.encode(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="fileUrlObject"; filename="${escapeMultipart(file.name)}"\r\n` +
        `Content-Type: ${file.mimeType}\r\n\r\n`
    ),
    fileBytes,
    enc.encode('\r\n')
  );
  parts.push(enc.encode(`--${boundary}--\r\n`));
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const body = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    body.set(p, offset);
    offset += p.length;
  }
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

function escapeMultipart(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function submitJob(
  fileUrl: string,
  fileName: string,
  config: AliyunDocParserConfig,
  signal?: AbortSignal
): Promise<string> {
  const json = await callAliyun({
    endpoint: config.endpoint,
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret,
    action: 'SubmitDocParserJob',
    body: {
      FileUrl: fileUrl,
      FileName: fileName,
      OutputFormat: 'markdown',
      LlmEnhancement: config.llmEnhancement,
      EnhancementMode: config.enhancementMode || undefined,
    },
    signal,
  });
  const id = json?.Data?.Id ?? json?.Id ?? json?.data?.id;
  if (typeof id !== 'string') throw new Error('阿里云文档解析提交响应缺少任务 ID');
  return id;
}

async function queryStatus(
  id: string,
  config: AliyunDocParserConfig,
  signal?: AbortSignal
): Promise<string> {
  const json = await callAliyun({
    endpoint: config.endpoint,
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret,
    action: 'QueryDocParserStatus',
    body: { Id: id },
    signal,
  });
  return String(json?.Data?.Status ?? json?.Status ?? json?.data?.status ?? '');
}

async function fetchResult(
  id: string,
  config: AliyunDocParserConfig,
  signal?: AbortSignal
): Promise<string> {
  const chunks: string[] = [];
  let layoutNum = 0;
  const layoutStepSize = 100;
  for (;;) {
    const json = await callAliyun({
      endpoint: config.endpoint,
      accessKeyId: config.accessKeyId,
      accessKeySecret: config.accessKeySecret,
      action: 'GetDocParserResult',
      body: { Id: id, LayoutNum: layoutNum, LayoutStepSize: layoutStepSize },
      signal,
    });
    const data = json?.Data ?? json?.data ?? json;
    const items = resultItems(data);
    for (const item of items) {
      const markdown =
        item?.markdownContent ?? item?.MarkdownContent ?? item?.text ?? item?.Text;
      if (typeof markdown === 'string' && markdown) chunks.push(markdown);
    }
    if (items.length < layoutStepSize) break;
    layoutNum += items.length;
  }
  return chunks.join('\n\n').trim();
}

function resultItems(data: any): any[] {
  const layouts = data?.layouts ?? data?.Layouts;
  if (Array.isArray(layouts)) return layouts;
  const segments = data?.segments ?? data?.Segments;
  if (Array.isArray(segments)) return segments;
  const markdown = data?.markdownContent ?? data?.MarkdownContent;
  return typeof markdown === 'string' && markdown ? [data] : [];
}

async function pollDone(
  id: string,
  config: AliyunDocParserConfig,
  signal?: AbortSignal
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < POLL_MAX_MS) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const status = await queryStatus(id, config, signal);
    if (/success|finish|completed|done/i.test(status)) return;
    if (/fail|error/i.test(status)) throw new Error(`阿里云文档解析失败：${status}`);
  }
  throw new Error('阿里云文档解析超时（超过 10 分钟）');
}

export async function parseDocument(
  f: PickedFile,
  config: AliyunDocParserConfig,
  signal?: AbortSignal
): Promise<string> {
  const uploaded = await uploadToOss(f, config, signal);
  try {
    const id = await submitJob(uploaded.url, f.name, config, signal);
    await pollDone(id, config, signal);
    const text = await fetchResult(id, config, signal);
    if (!text) throw new Error('阿里云文档解析结果为空');
    return text;
  } finally {
    // 即使主流程超时，也尽量清理临时 OSS 对象；清理请求有独立的 30 秒上限。
    await deleteOssObject(config, uploaded.objectKey);
  }
}
