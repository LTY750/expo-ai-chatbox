// 图片 OCR —— DeepSeek-OCR（视觉模型，OpenAI 多模态格式）
// 独立配置：baseURL/model 来自 settings.ocr，key 存 SecureStore（id 'ocr'）
import { fetch as expoFetch } from 'expo/fetch';

const OCR_PROMPT = '提取这张图片里的全部文字，保留原始排版和表格结构，用 markdown 输出。只输出识别到的内容，不要解释。';

export async function ocrImage(opts: {
  baseURL: string;
  model: string;
  apiKey: string;
  base64: string;
  mime: string;
}): Promise<string> {
  const { baseURL, model, apiKey, base64, mime } = opts;
  const url = baseURL.replace(/\/$/, '') + '/chat/completions';
  const res = await expoFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: OCR_PROMPT },
            {
              type: 'image_url',
              image_url: { url: `data:${mime};base64,${base64}` },
            },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OCR HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = await res.json();
  return json?.choices?.[0]?.message?.content ?? '';
}
