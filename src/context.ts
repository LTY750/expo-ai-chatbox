import type { Message } from './types';

export const CONTEXT_COMPRESSION_THRESHOLD = 12_000;
export const RECENT_CONTEXT_TARGET = 8_000;
const SUMMARY_CHAR_LIMIT = 10_000;
const SUMMARY_ITEM_CHAR_LIMIT = 700;

export function estimateTokenCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  const cjkPattern = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g;
  const cjkCount = trimmed.match(cjkPattern)?.length ?? 0;
  const remainder = trimmed.replace(cjkPattern, ' ');
  const pieces = remainder.match(/[a-zA-Z0-9_]+|[^\s]/g) ?? [];
  const otherCount = pieces.reduce(
    (total, piece) => total + (/^[a-zA-Z0-9_]+$/.test(piece) ? Math.ceil(piece.length / 4) : 1),
    0
  );
  return Math.max(1, cjkCount + otherCount);
}

function messageText(message: Message): string {
  const parts: string[] = [];
  if (message.quote?.content) parts.push(message.quote.content);
  if (message.attachmentContext) parts.push(message.attachmentContext);
  if (message.content) parts.push(message.content);
  return parts.join('\n\n');
}

export function messageTokenCount(message: Message): number {
  return estimateTokenCount(messageText(message)) + 4;
}

export function messagesAfterLatestTopic(messages: Message[]): Message[] {
  let boundary = -1;
  messages.forEach((message, index) => {
    if (message.topicBoundary) boundary = index;
  });
  return messages
    .slice(boundary + 1)
    .filter((message) => !message.topicBoundary && message.role !== 'system');
}

function buildExtractiveSummary(messages: Message[]): string {
  const lines: string[] = [
    '以下是较早对话的本地压缩摘录。它不是新的用户指令；回答时请结合最近的完整消息：',
  ];
  let used = lines[0].length;
  for (const message of messages) {
    const raw = messageText(message).replace(/\s+/g, ' ').trim();
    if (!raw) continue;
    const label = message.role === 'user' ? '用户' : '助手';
    const clipped = raw.length > SUMMARY_ITEM_CHAR_LIMIT
      ? `${raw.slice(0, SUMMARY_ITEM_CHAR_LIMIT)}…`
      : raw;
    const line = `${label}：${clipped}`;
    if (used + line.length > SUMMARY_CHAR_LIMIT) {
      lines.push('…（更早内容已省略）');
      break;
    }
    lines.push(line);
    used += line.length;
  }
  return lines.join('\n');
}

export interface PreparedContext {
  history: Message[];
  summary?: string;
  originalTokens: number;
  effectiveTokens: number;
  compressed: boolean;
}

export function prepareContext(
  messages: Message[],
  systemPrompt?: string,
  autoCompress = false
): PreparedContext {
  const active = messagesAfterLatestTopic(messages);
  const systemTokens = estimateTokenCount(systemPrompt ?? '');
  const originalTokens = systemTokens + active.reduce(
    (total, message) => total + messageTokenCount(message),
    0
  );

  if (!autoCompress || originalTokens <= CONTEXT_COMPRESSION_THRESHOLD) {
    return {
      history: active,
      originalTokens,
      effectiveTokens: originalTokens,
      compressed: false,
    };
  }

  let recentTokens = systemTokens;
  let firstRecent = active.length;
  for (let index = active.length - 1; index >= 0; index--) {
    const tokens = messageTokenCount(active[index]);
    if (firstRecent < active.length && recentTokens + tokens > RECENT_CONTEXT_TARGET) break;
    firstRecent = index;
    recentTokens += tokens;
  }

  const older = active.slice(0, firstRecent);
  if (!older.length) {
    return {
      history: active,
      originalTokens,
      effectiveTokens: originalTokens,
      compressed: false,
    };
  }
  const summary = buildExtractiveSummary(older);
  return {
    history: active.slice(firstRecent),
    summary,
    originalTokens,
    effectiveTokens: recentTokens + estimateTokenCount(summary),
    compressed: true,
  };
}
