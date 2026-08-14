// 工具注册 + 执行路由
// 统一工具定义格式（内部用），各 Provider 负责转成自家协议格式
// 执行器按工具名路由到具体实现（联网搜索可选 Tavily 或 Bocha）

import { bochaSearch, formatSearchResult } from './bocha';
import { tavilySearch, formatTavilyResult } from './tavily';
import type { ToolDef, ToolExecutor } from '../providers/base';
import type { TavilySearchDepth, WebSearchProvider } from '../types';

// 联网搜索工具定义
export const WEB_SEARCH_TOOL: ToolDef = {
  name: 'web_search',
  description:
    '联网搜索最新信息。当用户问及实时数据、新闻、近期事件、或你不确定的事实，且需要最新资料时调用。不要用于常识或你已确信的问题。',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '搜索关键词，用最可能命中的简短表达',
      },
    },
    required: ['query'],
  },
};

// 构造执行器：按设置的联网搜索服务商路由请求
export interface WebSearchCredentials {
  provider: WebSearchProvider;
  tavilyKey?: string;
  bochaKey?: string;
  searchDepth?: TavilySearchDepth;
}

export function makeToolExecutor(credentials: WebSearchCredentials): ToolExecutor {
  return async (name: string, args: any, signal?: AbortSignal): Promise<string> => {
    if (name === 'web_search') {
      const query = typeof args?.query === 'string' ? args.query.trim() : '';
      if (!query) return '搜索失败：缺少 query 参数';
      try {
        if (credentials.provider === 'bocha') {
          if (!credentials.bochaKey?.trim()) return '搜索失败：未配置 Bocha API Key';
          const result = await bochaSearch(credentials.bochaKey, query, { signal });
          return formatSearchResult(result, query);
        }
        if (!credentials.tavilyKey?.trim()) return '搜索失败：未配置 Tavily API Key';
        const result = await tavilySearch(credentials.tavilyKey, query, {
          searchDepth: credentials.searchDepth,
          signal,
        });
        return formatTavilyResult(result, query);
      } catch (e: any) {
        return `搜索失败：${e?.message ?? String(e)}`;
      }
    }
    return `未知工具：${name}`;
  };
}

// 当前启用的工具列表（联网开关打开时用）
export function getEnabledTools(): ToolDef[] {
  return [WEB_SEARCH_TOOL];
}
