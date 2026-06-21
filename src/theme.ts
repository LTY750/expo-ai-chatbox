// 主题系统 —— 定义颜色 token + useTheme hook
// 支持浅色 / 深色 / 跟随系统三种模式
import { useColorScheme } from 'react-native';
import { useChatStore } from './store';

/** 主题模式：light / dark / system（跟随系统） */
export type ThemeMode = 'light' | 'dark' | 'system';

/** 全部颜色 token —— 覆盖应用中所有需要主题化的颜色 */
export interface ThemeColors {
  /** 主背景 */
  background: string;
  /** 次级背景（header / toolbar 等） */
  surface: string;
  /** 三级背景（气泡 / 模型按钮等） */
  surfaceVariant: string;
  /** 主文字 */
  textPrimary: string;
  /** 次文字 */
  textSecondary: string;
  /** 提示 / 占位文字 */
  textTertiary: string;
  /** 边框 */
  border: string;
  /** 浅边框 */
  borderLight: string;
  /** 主色（按钮 / 链接） */
  primary: string;
  /** 主色浅底（选中态 / 引用块） */
  primaryLight: string;
  /** 危险色 */
  danger: string;
  /** 用户气泡背景 */
  userBubble: string;
  /** 用户气泡文字 */
  userBubbleText: string;
  /** AI 气泡背景 */
  aiBubble: string;
  /** AI 气泡文字 */
  aiBubbleText: string;
  /** 代码块背景 */
  codeBg: string;
  /** 代码块文字 */
  codeText: string;
  /** 提示横幅背景 */
  bannerBg: string;
  /** 提示横幅文字 */
  bannerText: string;
  /** 输入框背景 */
  inputBg: string;
  /** 占位符文字色 */
  placeholder: string;
  /** 遮罩 */
  overlay: string;
  /** 行内代码背景 */
  codeInlineBg: string;
  /** 行内代码文字 */
  codeInlineText: string;
  /** 引用块背景 */
  blockquoteBg: string;
}

/** 浅色主题 */
export const lightTheme: ThemeColors = {
  background: '#ffffff',
  surface: '#fafafa',
  surfaceVariant: '#f1f1f1',
  textPrimary: '#111111',
  textSecondary: '#666666',
  textTertiary: '#999999',
  border: '#dddddd',
  borderLight: '#eeeeee',
  primary: '#2563eb',
  primaryLight: '#eef2ff',
  danger: '#dc2626',
  userBubble: '#2563eb',
  userBubbleText: '#ffffff',
  aiBubble: '#f1f1f1',
  aiBubbleText: '#111111',
  codeBg: '#282c34',
  codeText: '#e6e6e6',
  bannerBg: '#fef3c7',
  bannerText: '#92400e',
  inputBg: '#ffffff',
  placeholder: '#999999',
  overlay: 'rgba(0,0,0,0.4)',
  codeInlineBg: '#e3e3e3',
  codeInlineText: '#c7254e',
  blockquoteBg: '#eef2ff',
};

/** 深色主题 */
export const darkTheme: ThemeColors = {
  background: '#1a1a1a',
  surface: '#242424',
  surfaceVariant: '#2a2a2a',
  textPrimary: '#e0e0e0',
  textSecondary: '#999999',
  textTertiary: '#666666',
  border: '#333333',
  borderLight: '#2a2a2a',
  primary: '#2563eb',
  primaryLight: '#1e2a44',
  danger: '#dc2626',
  userBubble: '#2563eb',
  userBubbleText: '#ffffff',
  aiBubble: '#2a2a2a',
  aiBubbleText: '#e0e0e0',
  codeBg: '#282c34',
  codeText: '#e6e6e6',
  bannerBg: '#3a2e1a',
  bannerText: '#fbbf24',
  inputBg: '#1a1a1a',
  placeholder: '#555555',
  overlay: 'rgba(0,0,0,0.4)',
  codeInlineBg: '#3a3a3a',
  codeInlineText: '#e06c75',
  blockquoteBg: '#1e2a44',
};

/** 当前是否为深色主题（结合用户选择 + 系统设置） */
export function useIsDark(): boolean {
  const themeMode = useChatStore((s) => s.themeMode);
  const systemScheme = useColorScheme();
  return themeMode === 'dark' || (themeMode === 'system' && systemScheme === 'dark');
}

/** 获取当前生效的主题颜色 */
export function useTheme(): ThemeColors {
  const isDark = useIsDark();
  return isDark ? darkTheme : lightTheme;
}
