// Provider 基类 —— 借鉴 Chatbox：每家模型继承统一基类，对外暴露一致的「发消息 → 流式返回」接口
// 新增一家模型只需写一个子类，业务层不变
// 工具调用（Function Calling）：streamChat 内部自动循环（模型调工具 → 执行 → 回传 → 继续生成）

import type { Message, ModelSettings } from '../types';

// 工具调用记录（assistant 发起）
export interface ToolCall {
  id: string;
  name: string;
  arguments: string; // JSON 字符串
}

// 发给模型的消息（去掉本地字段）
// tool 角色消息 = 工具执行结果回传；assistant 带 toolCalls = 模型发起调用
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[]; // 仅 assistant，模型发起的工具调用
  toolCallId?: string; // 仅 tool 角色，对应哪次调用
}

// 工具定义（统一内部格式，各 Provider 负责转成自家协议格式）
export interface ToolDef {
  name: string;
  description: string;
  parameters: object; // JSON Schema
}

// 工具执行器：按名调用，返回结果文本
// signal 用于中断工具执行（如用户点停止）
export type ToolExecutor = (
  name: string,
  args: any,
  signal?: AbortSignal
) => Promise<string>;

// 流式回调：每来一段增量文本就调一次
export interface StreamCallbacks {
  onDelta: (text: string) => void;
  onToolCall?: (name: string, args: any) => void; // 模型决定调用工具时通知 UI
  onDone: () => void;
  onError: (err: Error) => void;
}

export interface ChatOptions {
  messages: ChatMessage[];
  settings: ModelSettings;
  apiKey: string;
  signal?: AbortSignal;
  tools?: ToolDef[]; // 启用的工具列表（联网开关打开时传入）
  executeTool?: ToolExecutor; // 工具执行器
}

export abstract class BaseProvider {
  abstract readonly type: string;
  readonly baseURL: string;

  constructor(baseURL: string) {
    // 去掉结尾斜杠，统一拼路径
    this.baseURL = baseURL.replace(/\/$/, '');
  }

  // 流式对话：子类实现具体的请求 + SSE 解析 + 工具循环
  // 当 tools + executeTool 都传入时，子类应在内部处理工具调用循环
  abstract streamChat(opts: ChatOptions, cb: StreamCallbacks): Promise<void>;

  // 非流式单次补全 —— 给「自动总结对话标题」用，返回完整文本
  abstract complete(opts: ChatOptions): Promise<string>;

  // 拉取该服务商的可用模型列表（失败抛错，由 UI 接住）
  abstract listModels(apiKey: string): Promise<string[]>;
}

// 把本地 Message[] 转成发给模型的 ChatMessage[]，并按设置注入 system prompt
// 注意：工具调用过程不落库，所以 history 里不会有 tool 角色消息
export function buildChatMessages(
  history: Message[],
  settings: ModelSettings
): ChatMessage[] {
  const out: ChatMessage[] = [];
  if (settings.systemPrompt?.trim()) {
    out.push({ role: 'system', content: settings.systemPrompt.trim() });
  }
  for (const m of history) {
    if (m.role === 'system') continue; // system 由设置统一注入
    if (!m.content) continue;
    out.push({ role: m.role, content: m.content });
  }
  return out;
}
