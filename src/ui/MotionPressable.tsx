import { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
} from 'react-native';
import { MOTION_DURATION } from './motion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function MotionPressable({
  pressScale = 0.97,
  disabled,
  onPressIn,
  onPressOut,
  style,
  ...props
}: PressableProps & { pressScale?: number }) {
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => () => scale.stopAnimation(), [scale]);

  const animate = (toValue: number, duration: number) => {
    scale.stopAnimation();
    Animated.timing(scale, {
      toValue,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  };

  const handlePressIn = (event: GestureResponderEvent) => {
    if (!disabled) animate(pressScale, MOTION_DURATION.pressIn);
    onPressIn?.(event);
  };

  const handlePressOut = (event: GestureResponderEvent) => {
    animate(1, MOTION_DURATION.pressOut);
    onPressOut?.(event);
  };

  const animatedStyle = { transform: [{ scale }] };
  const resolvedStyle =
    typeof style === 'function'
      ? (state: any) => [style(state), animatedStyle]
      : [style, animatedStyle];

  return (
    <AnimatedPressable
      {...props}
      disabled={disabled}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={resolvedStyle as any}
    />
  );
}
