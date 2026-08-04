import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '../theme';
import { MOTION_DURATION, MOTION_EASING } from './motion';

export function BottomSheetModal({
  visible,
  onRequestClose,
  sheetStyle,
  children,
}: {
  visible: boolean;
  onRequestClose: () => void;
  sheetStyle?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const theme = useTheme();
  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const renderedChildrenRef = useRef(children);
  if (visible) renderedChildrenRef.current = children;

  useEffect(() => {
    progress.stopAnimation();
    let frame: number | null = null;

    if (visible) {
      if (!mounted) {
        setMounted(true);
        return;
      }

      frame = requestAnimationFrame(() => {
        Animated.timing(progress, {
          toValue: 1,
          duration: MOTION_DURATION.enter,
          easing: MOTION_EASING.enter,
          useNativeDriver: true,
        }).start();
      });
    } else if (mounted) {
      Animated.timing(progress, {
        toValue: 0,
        duration: MOTION_DURATION.exit,
        easing: MOTION_EASING.exit,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [mounted, progress, visible]);

  useEffect(() => () => progress.stopAnimation(), [progress]);

  // `visible` 变为 true 的当前帧就挂载 Modal，避免极快按返回时事件落到底层页面。
  if (!mounted && !visible) return null;

  return (
    <Modal
      visible
      transparent
      animationType="none"
      onRequestClose={onRequestClose}
    >
      <View style={styles.root}>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: theme.overlay, opacity: progress },
          ]}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={onRequestClose} />
        </Animated.View>
        <Animated.View
          style={[
            sheetStyle,
            {
              opacity: progress,
              transform: [
                {
                  translateY: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [36, 0],
                  }),
                },
                {
                  scale: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.985, 1],
                  }),
                },
              ],
            },
          ]}
        >
          {renderedChildrenRef.current}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
});
