// 解析层路由 —— 按文件类型分流：文本本地读取 / 图片走 OCR / 文档走 LlamaParse
// content:// URI（DocumentPicker copyToCacheDirectory:false）自带读权限，
// 用新 File API 读；legacy 硬拒 content scheme，仅作 file:// 兜底
import { File } from 'expo-file-system';
import * as FS from 'expo-file-system/legacy';
import { ocrImage } from './ocr';
import { parseDocument as llamaParseDocument } from './llamaparse';

// 上层传入的待解析文件（来自 document-picker / image-picker）
export interface PickedFile {
  uri: string;
  name: string;
  mimeType?: string;
}

export interface OcrConfig {
  baseURL: string;
  model: string;
  apiKey: string;
}

export interface LlamaParseConfig {
  apiKey: string;
}

export interface ParseResult {
  kind: 'text' | 'image' | 'document';
  text: string;
}

const TEXT_EXT = ['txt', 'md', 'markdown', 'csv', 'json', 'log', 'xml', 'yaml', 'yml'];
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'heic'];
// LlamaParse 支持的文档类型
const DOC_EXT = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'odt', 'odp', 'ods', 'rtf', 'epub'];
const DOC_MIME_PREFIX = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.oasis.opendocument',
  'application/rtf',
  'application/epub',
];

function ext(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

function isImage(f: PickedFile): boolean {
  if (f.mimeType?.startsWith('image/')) return true;
  return IMAGE_EXT.includes(ext(f.name));
}

function isText(f: PickedFile): boolean {
  if (f.mimeType?.startsWith('text/')) return true;
  if (f.mimeType === 'application/json') return true;
  return TEXT_EXT.includes(ext(f.name));
}

function isDocument(f: PickedFile): boolean {
  if (f.mimeType && DOC_MIME_PREFIX.some((p) => f.mimeType!.startsWith(p))) return true;
  return DOC_EXT.includes(ext(f.name));
}

const MAX_TEXT_CHARS = 30000; // 防止爆上下文

export async function parseFile(
  f: PickedFile,
  ocr?: OcrConfig,
  llamaParse?: LlamaParseConfig
): Promise<ParseResult> {
  if (isImage(f)) {
    if (!ocr?.apiKey) {
      throw new Error('请先在设置里配置文档解析(OCR)的 API Key');
    }
    const base64 = await FS.readAsStringAsync(f.uri, {
      encoding: FS.EncodingType.Base64,
    });
    const mime = f.mimeType || guessImageMime(f.name);
    let text = await ocrImage({
      baseURL: ocr.baseURL,
      model: ocr.model,
      apiKey: ocr.apiKey,
      base64,
      mime,
    });
    text = truncate(text);
    return { kind: 'image', text };
  }

  if (isDocument(f)) {
    if (!llamaParse?.apiKey) {
      throw new Error('请先在设置里配置 LlamaParse 的 API Key');
    }
    let text = await llamaParseDocument(f, llamaParse);
    text = truncate(text);
    return { kind: 'document', text };
  }

  if (isText(f)) {
    // 多策略尝试，谁成谁上，全程异步
    const tries: Array<[string, () => Promise<string>]> = [
      ['File.text', async () => await new File(f.uri).text()],
      ['legacy', async () =>
        await FS.readAsStringAsync(f.uri, { encoding: FS.EncodingType.UTF8 })],
    ];
    let lastErr = '';
    for (const [tag, fn] of tries) {
      try {
        const text = await fn();
        if (text) return { kind: 'text', text: truncate(text) };
      } catch (e: any) {
        lastErr = `${tag}: ${e?.message ?? e}`;
      }
    }
    throw new Error('读取文件失败：' + lastErr);
  }

  throw new Error(
    `暂不支持的文件类型：${ext(f.name) || f.mimeType || '未知'}（当前支持 txt/md/csv 等文本、图片、PDF/Word/PPT 文档）`
  );
}

function truncate(s: string): string {
  if (s.length <= MAX_TEXT_CHARS) return s;
  return s.slice(0, MAX_TEXT_CHARS) + '\n\n…（内容过长，已截断）';
}

function guessImageMime(name: string): string {
  const e = ext(name);
  if (e === 'png') return 'image/png';
  if (e === 'webp') return 'image/webp';
  if (e === 'gif') return 'image/gif';
  return 'image/jpeg';
}
