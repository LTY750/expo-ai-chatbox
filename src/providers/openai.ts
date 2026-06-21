// 通用 OpenAI 兼容 Provider —— 硅基流动 / DeepSeek / OpenAI / 智谱 等都走这套
// 用 expo/fetch（SDK 56 原生支持 ReadableStream）
// 支持 Function Calling：streamChat 内部自动循环（模型调工具 → 执行 → 回传 → 继续生成）
import { fetch as expoFetch } from 'expo/fetch';
import {
  BaseProvider,
  type ChatMessage,
  type ChatOptions,
  type StreamCallbacks,
  type ToolCall,
} from './base';

// parseSSE 的返回：累积的文本 + 工具调用列表
interface ParseResult {
  text: string;
  toolCalls: ToolCall[];
}

export class OpenAICompatProvider extends BaseProvider {
  readonly type = 'openai';

  async streamChat(opts: ChatOptions, cb: StreamCallbacks): Promise<void> {
    const { messages, settings, apiKey, signal, tools, executeTool } = opts;
    const canUseTools = !!(tools?.length && executeTool);
    // 最多 5 次工具调用（非总轮数），防止死循环
    const MAX_TOOL_CALLS = 5;
    let currentMessages = [...messages];
    let toolCallCount = 0;

    try {
      for (;;) {
        const body: any = {
          model: settings.model,
          messages: this.toOpenAIMessages(currentMessages),
          stream: true,
          temperature: settings.temperature,
          max_tokens: settings.maxTokens,
        };
        // 达到工具调用上限后，本轮不再传 tools，让模型基于已有结果总结
        const allowTools = canUseTools && toolCallCount < MAX_TOOL_CALLS;
        if (allowTools) {
          body.tools = tools!.map((t) => ({
            type: 'function',
            function: {
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            },
          }));
        }

        const res = await expoFetch(`${this.baseURL}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal,
        });

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
        }
        if (!res.body) throw new Error('响应没有 body，无法流式读取');

        const { text, toolCalls } = await this.parseSSE(res.body, cb);

        // 没有工具调用，或不允许再调工具 → 本轮结束
        if (!toolCalls.length || !allowTools) {
          cb.onDone();
          return;
        }

        // 有工具调用：把 assistant 的文本 + tool_calls 加入历史
        currentMessages.push({
          role: 'assistant',
          content: text,
          toolCalls,
        });
        for (const tc of toolCalls) {
          let args: any = {};
          try {
            args = JSON.parse(tc.arguments || '{}');
          } catch {
            // arguments 解析失败，给空对象
          }
          cb.onToolCall?.(tc.name, args);
          const result = await executeTool!(tc.name, args, signal);
          currentMessages.push({
            role: 'tool',
            content: result,
            toolCallId: tc.id,
          });
          toolCallCount++;
        }
        // 继续下一轮，让模型基于工具结果继续生成
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        cb.onDone();
        return;
      }
      cb.onError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  // 非流式补全（标题总结用，不支持工具）
  async complete(opts: ChatOptions): Promise<string> {
    const { messages, settings, apiKey, signal } = opts;
    const res = await expoFetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model,
        messages: this.toOpenAIMessages(messages),
        stream: false,
        temperature: settings.temperature,
        max_tokens: settings.maxTokens,
      }),
      signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    const json = await res.json();
    return json?.choices?.[0]?.message?.content ?? '';
  }

  // GET /models
  async listModels(apiKey: string): Promise<string[]> {
    const res = await expoFetch(`${this.baseURL}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    const json = await res.json();
    const data = json?.data ?? [];
    return data
      .map((m: any) => m?.id)
      .filter((x: any): x is string => typeof x === 'string')
      .sort();
  }

  // 把统一 ChatMessage[] 转成 OpenAI 协议格式
  // tool 角色 → { role:'tool', tool_call_id, content }
  // assistant 带 toolCalls → { role:'assistant', content, tool_calls:[...] }
  private toOpenAIMessages(msgs: ChatMessage[]): any[] {
    return msgs.map((m) => {
      if (m.role === 'tool') {
        return {
          role: 'tool',
          tool_call_id: m.toolCallId,
          content: m.content,
        };
      }
      if (m.role === 'assistant' && m.toolCalls?.length) {
        return {
          role: 'assistant',
          content: m.content || null,
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: tc.arguments },
          })),
        };
      }
      return { role: m.role, content: m.content };
    });
  }

  // 解析 OpenAI 风格 SSE：data: {...}\n\n，结束标志 data: [DONE]
  // 同时处理 content delta（实时回调 + 累积）和 tool_calls delta（累积，流结束返回）
  private async parseSSE(
    body: ReadableStream<Uint8Array>,
    cb: StreamCallbacks
  ): Promise<ParseResult> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    // 按 index 累积 tool_calls（流式中分片到达）
    const toolCalls: Map<number, ToolCall> = new Map();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const json = JSON.parse(data);
          const delta = json?.choices?.[0]?.delta;
          if (!delta) continue;

          // 文本增量：实时回调 + 累积（供工具循环回填 assistant content）
          if (typeof delta.content === 'string' && delta.content) {
            text += delta.content;
            cb.onDelta(delta.content);
          }

          // 工具调用增量：按 index 累积
          if (Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const idx = typeof tc.index === 'number' ? tc.index : 0;
              const existing = toolCalls.get(idx);
              if (!existing) {
                toolCalls.set(idx, {
                  id: tc.id ?? '',
                  name: tc.function?.name ?? '',
                  arguments: tc.function?.arguments ?? '',
                });
              } else {
                if (tc.id) existing.id = tc.id;
                if (tc.function?.name) existing.name = tc.function.name;
                if (tc.function?.arguments)
                  existing.arguments += tc.function.arguments;
              }
            }
          }
        } catch {
          // 不完整片段，跳过
        }
      }
    }
    // 按 index 排序后返回
    const sortedCalls = Array.from(toolCalls.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, v]) => v);
    return { text, toolCalls: sortedCalls };
  }
}
