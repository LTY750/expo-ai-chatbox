// Anthropic Messages Provider —— 协议与 OpenAI 不同：
// 端点 /v1/messages、认证 x-api-key、system 提顶层、SSE 事件 content_block_delta
// 工具调用：tools 用 input_schema；工具结果是 user 消息里的 tool_result block；
// 流式中 tool_use 的参数通过 input_json_delta 分片累积
import { fetch as expoFetch } from 'expo/fetch';
import {
  BaseProvider,
  type ChatMessage,
  type ChatOptions,
  type StreamCallbacks,
  type ToolCall,
} from './base';

const ANTHROPIC_VERSION = '2023-06-01';

// parseSSE 的返回
interface ParseResult {
  text: string;
  toolCalls: ToolCall[];
  contentBlocks: Array<Record<string, any>>;
}

export class AnthropicProvider extends BaseProvider {
  readonly type = 'anthropic';

  private headers(apiKey: string) {
    return {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    };
  }

  // 提取 system（Anthropic 放顶层），其余转成 user/assistant
  private split(messages: ChatMessage[]): { system?: string; msgs: ChatMessage[] } {
    let system: string | undefined;
    const msgs: ChatMessage[] = [];
    for (const m of messages) {
      if (m.role === 'system') {
        system = system ? `${system}\n${m.content}` : m.content;
      } else {
        msgs.push(m);
      }
    }
    return { system, msgs };
  }

  async streamChat(opts: ChatOptions, cb: StreamCallbacks): Promise<void> {
    const { messages, settings, apiKey, signal, tools, executeTool } = opts;
    const canUseTools = !!(tools?.length && executeTool);
    const MAX_TOOL_CALLS = 5;
    let currentMessages = [...messages];
    let toolCallCount = 0;

    try {
      for (;;) {
        const { system, msgs } = this.split(currentMessages);
        const body: any = {
          model: settings.model,
          messages: this.toAnthropicMessages(msgs),
          stream: true,
        };
        this.applyGenerationSettings(body, settings);
        if (system) body.system = system;
        const allowTools = canUseTools && toolCallCount < MAX_TOOL_CALLS;
        if (allowTools) {
          body.tools = tools!.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters,
          }));
        }

        const res = await expoFetch(`${this.baseURL}/v1/messages`, {
          method: 'POST',
          headers: this.headers(apiKey),
          body: JSON.stringify(body),
          signal,
        });

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
        }
        if (!res.body) throw new Error('响应没有 body，无法流式读取');

        const { text, toolCalls, contentBlocks } = await this.parseSSE(res.body, cb);

        // 没有工具调用，或不允许再调工具 → 本轮结束
        if (!toolCalls.length || !allowTools) {
          cb.onDone();
          return;
        }

        // 有工具调用：把 assistant 的文本 + tool_use 加入历史
        currentMessages.push({
          role: 'assistant',
          content: text,
          toolCalls,
          anthropicContent: contentBlocks,
        });
        // 执行所有工具，收集结果
        const toolResults: Array<{ id: string; content: string }> = [];
        for (const tc of toolCalls) {
          let args: any = {};
          try {
            args = JSON.parse(tc.arguments || '{}');
          } catch {
            // arguments 解析失败，给空对象
          }
          cb.onToolCall?.(tc.name, args);
          const result = await executeTool!(tc.name, args, signal);
          cb.onToolResult?.(tc.name, args, result);
          toolResults.push({ id: tc.id, content: result });
          toolCallCount++;
        }
        // Anthropic 要求一轮的多个 tool_result 放在同一个 user 消息里
        // toAnthropicMessages 会把连续的 tool 角色消息合并为一个 user 消息
        for (const tr of toolResults) {
          currentMessages.push({
            role: 'tool',
            content: tr.content,
            toolCallId: tr.id,
          });
        }
        // 继续下一轮
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        cb.onDone();
        return;
      }
      cb.onError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  async complete(opts: ChatOptions): Promise<string> {
    const { messages, settings, apiKey, signal } = opts;
    const { system, msgs } = this.split(messages);
    const body = this.applyGenerationSettings({
      model: settings.model,
      messages: this.toAnthropicMessages(msgs),
      stream: false,
    }, settings);
    if (system) body.system = system;
    const res = await expoFetch(`${this.baseURL}/v1/messages`, {
      method: 'POST',
      headers: this.headers(apiKey),
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    const json = await res.json();
    return json?.content?.[0]?.text ?? '';
  }

  // GET /v1/models
  async listModels(apiKey: string): Promise<string[]> {
    const res = await expoFetch(`${this.baseURL}/v1/models`, {
      method: 'GET',
      headers: this.headers(apiKey),
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

  private applyGenerationSettings(body: any, settings: ChatOptions['settings']): any {
    const budgetByEffort = {
      low: 1024,
      medium: 2048,
      high: 4096,
    } as const;
    const effort = settings.reasoningEffort;
    if (effort && effort !== 'auto') {
      const budgetTokens = budgetByEffort[effort];
      body.thinking = { type: 'enabled', budget_tokens: budgetTokens };
      // Anthropic 的 max_tokens 包含思考预算，并且必须高于 budget_tokens。
      body.max_tokens = Math.max(settings.maxTokens ?? 4096, budgetTokens + 1024);
    } else {
      body.temperature = settings.temperature;
      body.top_p = settings.topP;
      body.max_tokens = settings.maxTokens ?? 4096;
    }
    return body;
  }

  // 把统一 ChatMessage[] 转成 Anthropic 协议格式
  // 连续的多个 tool 角色消息合并为一个 user 消息（content 为 tool_result block 数组）
  // assistant 带 toolCalls → assistant 消息 content 为 [text?, tool_use...]
  private toAnthropicMessages(msgs: ChatMessage[]): any[] {
    const out: any[] = [];
    let i = 0;
    while (i < msgs.length) {
      const m = msgs[i];
      if (m.role === 'system') {
        i++;
        continue;
      }
      if (m.role === 'tool') {
        // 合并连续的 tool 消息为一个 user 消息
        const results: any[] = [];
        while (i < msgs.length && msgs[i].role === 'tool') {
          results.push({
            type: 'tool_result',
            tool_use_id: msgs[i].toolCallId,
            content: msgs[i].content,
          });
          i++;
        }
        out.push({ role: 'user', content: results });
        continue;
      }
      if (m.role === 'assistant' && m.toolCalls?.length) {
        if (m.anthropicContent?.length) {
          out.push({ role: 'assistant', content: m.anthropicContent });
          i++;
          continue;
        }
        const content: any[] = [];
        if (m.content) content.push({ type: 'text', text: m.content });
        for (const tc of m.toolCalls) {
          let input: any = {};
          try {
            input = JSON.parse(tc.arguments || '{}');
          } catch {
            // 解析失败给空对象
          }
          content.push({ type: 'tool_use', id: tc.id, name: tc.name, input });
        }
        out.push({ role: 'assistant', content });
      } else {
        out.push({ role: m.role, content: m.content });
      }
      i++;
    }
    return out;
  }

  // Anthropic SSE：事件含 content_block_delta（text_delta / input_json_delta）
  // tool_use 的 id/name 在 content_block_start 给出，参数在 input_json_delta 分片累积
  private async parseSSE(
    body: ReadableStream<Uint8Array>,
    cb: StreamCallbacks
  ): Promise<ParseResult> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    // 按 index 跟踪 content block
    const blocks: Map<
      number,
      {
        type: string;
        toolUseId?: string;
        toolName?: string;
        toolInput?: string;
        text?: string;
        thinking?: string;
        signature?: string;
        raw?: Record<string, any>;
      }
    > = new Map();
    const toolCalls: ToolCall[] = [];

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
        try {
          const json = JSON.parse(data);

          if (json?.type === 'content_block_start') {
            const idx = typeof json.index === 'number' ? json.index : 0;
            const block = json.content_block;
            blocks.set(idx, {
              type: block?.type ?? '',
              toolUseId: block?.id,
              toolName: block?.name,
              toolInput: '',
              text: block?.text ?? '',
              thinking: block?.thinking ?? '',
              signature: block?.signature ?? '',
              raw: block,
            });
          } else if (json?.type === 'content_block_delta') {
            const idx = typeof json.index === 'number' ? json.index : 0;
            const block = blocks.get(idx);
            if (!block) continue;
            const delta = json.delta;
            if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
              text += delta.text;
              block.text = (block.text ?? '') + delta.text;
              cb.onDelta(delta.text);
            } else if (
              delta?.type === 'thinking_delta' &&
              typeof delta.thinking === 'string'
            ) {
              block.thinking = (block.thinking ?? '') + delta.thinking;
            } else if (
              delta?.type === 'signature_delta' &&
              typeof delta.signature === 'string'
            ) {
              block.signature = (block.signature ?? '') + delta.signature;
            } else if (
              delta?.type === 'input_json_delta' &&
              typeof delta.partial_json === 'string'
            ) {
              block.toolInput = (block.toolInput ?? '') + delta.partial_json;
            }
          } else if (json?.type === 'content_block_stop') {
            const idx = typeof json.index === 'number' ? json.index : 0;
            const block = blocks.get(idx);
            if (block?.type === 'tool_use' && block.toolUseId && block.toolName) {
              toolCalls.push({
                id: block.toolUseId,
                name: block.toolName,
                arguments: block.toolInput || '{}',
              });
            }
          }
        } catch {
          // 不完整片段，跳过
        }
      }
    }
    const contentBlocks = Array.from(blocks.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, block]) => {
        if (block.type === 'thinking') {
          return {
            type: 'thinking',
            thinking: block.thinking ?? '',
            ...(block.signature ? { signature: block.signature } : {}),
          };
        }
        if (block.type === 'redacted_thinking') {
          return block.raw ?? { type: 'redacted_thinking' };
        }
        if (block.type === 'tool_use') {
          let input: any = {};
          try {
            input = JSON.parse(block.toolInput || '{}');
          } catch {
            // 参数分片异常时保持空对象，与 ToolCall 的兼容行为一致
          }
          return {
            type: 'tool_use',
            id: block.toolUseId ?? '',
            name: block.toolName ?? '',
            input,
          };
        }
        return { type: 'text', text: block.text ?? '' };
      });
    return { text, toolCalls, contentBlocks };
  }
}
