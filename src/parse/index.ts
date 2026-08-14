// 解析层路由 —— 按文件类型分流：文本本地读取 / 图片走 OCR / 文档走 LlamaParse
// Android 的 DocumentPicker 保留系统授予读取权限的 content:// URI；
// 新 File API 负责统一读取 content:// / file://，legacy 仅作兼容兜底。
import { File } from 'expo-file-system';
import * as FS from 'expo-file-system/legacy';
import { ocrImage } from './ocr';
import { parseDocument as llamaParseDocument } from './llamaparse';

// 上层传入的待解析文件（来自 document-picker / image-picker）
export interface PickedFile {
  uri: string;
  name: string;
  mimeType?: string;
  size?: number;
}

export interface OcrConfig {
  baseURL: string;
  model: string;
  apiKey: string;
}

export interface LlamaParseConfig {
  apiKey: string;
}

export interface DocumentParserConfig {
  provider: 'llamaparse';
  llamaParse?: LlamaParseConfig;
}

export interface ParseResult {
  kind: 'text' | 'image' | 'document';
  text: string;
}

const TEXT_EXT = ['txt', 'md', 'markdown', 'csv', 'json', 'log', 'xml', 'yaml', 'yml'];
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'heic'];

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

const MAX_TEXT_CHARS = 30000; // 防止爆上下文

export async function parseFile(
  f: PickedFile,
  ocr?: OcrConfig,
  documentParser?: DocumentParserConfig
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

  if (isText(f)) {
    try {
      // 普通文本优先在设备本地读取，避免不必要的上传和额度消耗。
      return { kind: 'text', text: truncate(await readTextLocally(f)) };
    } catch (error: any) {
      // content:// 权限异常或编码问题时，交给 LlamaParse 兜底。
      return parseWithLlama(f, documentParser, `本地读取失败：${error?.message ?? error}`);
    }
  }

  // PDF、Office 文档以及未列出的文件类型统一交给 LlamaParse。
  return parseWithLlama(f, documentParser);
}

async function readTextLocally(f: PickedFile): Promise<string> {
  const tries: Array<[string, () => Promise<string>]> = [
    ['File.text', async () => await new File(f.uri).text()],
    ['legacy', async () =>
      await FS.readAsStringAsync(f.uri, { encoding: FS.EncodingType.UTF8 })],
  ];
  const errors: string[] = [];
  for (const [tag, fn] of tries) {
    try {
      return await fn();
    } catch (error: any) {
      errors.push(`${tag}: ${error?.message ?? error}`);
    }
  }
  throw new Error(errors.join('; '));
}

async function parseWithLlama(
  f: PickedFile,
  documentParser?: DocumentParserConfig,
  localError?: string
): Promise<ParseResult> {
  const apiKey = documentParser?.llamaParse?.apiKey?.trim();
  if (!apiKey) {
    const suffix = localError ? `（${localError}）` : '';
    throw new Error(`请先在设置里配置 LlamaParse 的 API Key${suffix}`);
  }
  const text = truncate(await llamaParseDocument(f, { apiKey }));
  return { kind: isText(f) ? 'text' : 'document', text };
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
