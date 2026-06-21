// 根据 Provider 配置造出对应协议的 Provider 实例
import type { Provider } from '../types';
import { BaseProvider } from './base';
import { OpenAICompatProvider } from './openai';
import { AnthropicProvider } from './anthropic';

export function makeProvider(p: Provider): BaseProvider {
  switch (p.type) {
    case 'anthropic':
      return new AnthropicProvider(p.baseURL);
    case 'openai':
    default:
      return new OpenAICompatProvider(p.baseURL);
  }
}
