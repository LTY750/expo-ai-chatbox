// 入口 —— 初始化 + 聊天/设置两屏切换 + 侧边栏抽屉
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useChatStore } from './src/store';
import ChatScreen from './src/ui/ChatScreen';
import SettingsScreen from './src/ui/SettingsScreen';
import Drawer from './src/ui/Drawer';

export default function App() {
  const init = useChatStore((s) => s.init);
  const initialized = useChatStore((s) => s.initialized);
  const [showSettings, setShowSettings] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    init().catch((e) => console.error('init failed', e));
  }, [init]);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safe}>
        <StatusBar style="dark" />
        {!initialized ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" />
          </View>
        ) : showSettings ? (
          <SettingsScreen onClose={() => setShowSettings(false)} />
        ) : (
          <>
            <ChatScreen
              onOpenDrawer={() => setDrawerOpen(true)}
              onOpenSettings={() => setShowSettings(true)}
            />
            <Drawer
              open={drawerOpen}
              onClose={() => setDrawerOpen(false)}
              onOpenSettings={() => setShowSettings(true)}
            />
          </>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#fff',
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
