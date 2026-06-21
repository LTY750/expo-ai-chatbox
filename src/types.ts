// 核心数据模型 —— 借鉴 Chatbox 的 Session / Message 设计

import type { ThemeMode } from './theme';

export type Role = 'system' | 'user' | 'assistant';

// 消息附件（文档/图片解析后的元信息；解析出的文本拼进 content 发给模型）
export interface Attachment {
  id: string;
  name: string;
  kind: 'text' | 'image' | 'document';
  status: 'parsing' | 'done' | 'error';
  chars?: number; // 解析出的字符数
  error?: string;
}

export interface Message {
  id: string;
  sessionId: string;
  role: Role;
  content: string;
  createdAt: number;
  // 生成状态：streaming 时 UI 显示光标/加载
  status?: 'pending' | 'streaming' | 'done' | 'error';
  error?: string;
  attachments?: Attachment[];
}

// 模型参数（发给 Provider 的有效设置，运行时由全局参数 + 当前模型拼成）
export interface ModelSettings {
  model: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

export interface Session {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  // 会话级模型设置覆盖（为空则继承全局）
  settingsOverride?: Partial<ModelSettings>;
}

// API 协议类型 —— 决定用哪套请求/解析逻辑
export type ProviderType = 'openai' | 'anthropic';

// 一个 API 服务商：下挂多个模型；key 不在这里，存 SecureStore
export interface Provider {
  id: string;
  name: string;
  type: ProviderType;
  baseURL: string;
  models: string[];
}

// 全局应用设置
export interface AppSettings {
  providers: Provider[];
  // 当前选中的服务商 + 模型
  currentProviderId: string;
  currentModel: string;
  // 全局生成参数
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  // 文档解析 OCR（独立配置；key 存 SecureStore，id 固定 'ocr'）
  ocr: { baseURL: string; model: string };
  // 主题模式
  theme: ThemeMode;
}
