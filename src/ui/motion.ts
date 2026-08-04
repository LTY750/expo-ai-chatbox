import { Easing } from 'react-native';

// 全应用共用的动画节奏：反馈快、界面切换适中、大片内容稍慢。
export const MOTION_DURATION = {
  pressIn: 90,
  pressOut: 140,
  exit: 160,
  enter: 220,
} as const;

export const MOTION_EASING = {
  enter: Easing.bezier(0.2, 0.8, 0.2, 1),
  exit: Easing.bezier(0.4, 0, 1, 1),
  standard: Easing.bezier(0.2, 0, 0, 1),
} as const;
