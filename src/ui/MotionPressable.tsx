import { useRef } from 'react';
import {
  Animated,
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
} from 'react-native';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function MotionPressable({
  pressScale = 0.94,
  disabled,
  onPressIn,
  onPressOut,
  style,
  ...props
}: PressableProps & { pressScale?: number }) {
  const scale = useRef(new Animated.Value(1)).current;

  const animate = (toValue: number) => {
    scale.stopAnimation();
    Animated.spring(scale, {
      toValue,
      useNativeDriver: true,
      speed: 42,
      bounciness: 1,
    }).start();
  };

  const handlePressIn = (event: GestureResponderEvent) => {
    if (!disabled) animate(pressScale);
    onPressIn?.(event);
  };

  const handlePressOut = (event: GestureResponderEvent) => {
    animate(1);
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
