import { useEffect, useMemo, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { useChatStore } from '../store';
import type { Session } from '../types';
import { useTheme, type ThemeColors } from '../theme';
import { AppIcon } from './AppIcon';
import { MotionPressable } from './MotionPressable';

type ImageField = 'userAvatarUri' | 'assistantAvatarUri' | 'backgroundImageUri';

async function persistPickedImage(uri: string, sessionId: string, field: ImageField): Promise<string> {
  const directory = new Directory(Paths.document, 'conversation-assets');
  directory.create({ intermediates: true, idempotent: true });
  const source = new File(uri);
  const extension = source.extension || '.jpg';
  const destination = new File(
    directory,
    `${sessionId}-${field}-${Date.now()}${extension}`
  );
  await source.copy(destination, { overwrite: true });
  return destination.uri;
}

export default function ConversationSettingsModal({
  visible,
  session,
  onClose,
  onError,
}: {
  visible: boolean;
  session: Session | null;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const globalSettings = useChatStore((state) => state.settings);
  const updateConversationSettings = useChatStore((state) => state.updateConversationSettings);

  const [temperature, setTemperature] = useState('0.7');
  const [topP, setTopP] = useState('1');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [userAvatarUri, setUserAvatarUri] = useState<string | undefined>();
  const [assistantAvatarUri, setAssistantAvatarUri] = useState<string | undefined>();
  const [backgroundImageUri, setBackgroundImageUri] = useState<string | undefined>();
  const [autoCompressContext, setAutoCompressContext] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible || !session) return;
    setTemperature(String(session.settingsOverride?.temperature ?? globalSettings.temperature));
    setTopP(String(session.settingsOverride?.topP ?? globalSettings.topP));
    setSystemPrompt(session.settingsOverride?.systemPrompt ?? globalSettings.systemPrompt);
    setUserAvatarUri(session.conversationSettings?.userAvatarUri);
    setAssistantAvatarUri(session.conversationSettings?.assistantAvatarUri);
    setBackgroundImageUri(session.conversationSettings?.backgroundImageUri);
    setAutoCompressContext(!!session.conversationSettings?.autoCompressContext);
  }, [visible, session, globalSettings]);

  async function pickImage(field: ImageField) {
    if (!session || saving) return;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.9,
      });
      if (result.canceled || !result.assets?.length) return;
      const uri = await persistPickedImage(result.assets[0].uri, session.id, field);
      if (field === 'userAvatarUri') setUserAvatarUri(uri);
      if (field === 'assistantAvatarUri') setAssistantAvatarUri(uri);
      if (field === 'backgroundImageUri') setBackgroundImageUri(uri);
    } catch (error: any) {
      onError(error?.message ?? String(error));
    }
  }

  async function save() {
    if (!session || saving) return;
    const parsedTemperature = Number(temperature);
    const parsedTopP = Number(topP);
    if (!Number.isFinite(parsedTemperature) || parsedTemperature < 0 || parsedTemperature > 2) {
      onError('Temperature 请输入 0 到 2 之间的数字');
      return;
    }
    if (!Number.isFinite(parsedTopP) || parsedTopP < 0 || parsedTopP > 1) {
      onError('Top P 请输入 0 到 1 之间的数字');
      return;
    }
    setSaving(true);
    try {
      await updateConversationSettings(
        session.id,
        {
          temperature: parsedTemperature,
          topP: parsedTopP,
          systemPrompt,
        },
        {
          userAvatarUri,
          assistantAvatarUri,
          backgroundImageUri,
          autoCompressContext,
        }
      );
      onClose();
    } catch (error: any) {
      onError(error?.message ?? String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={[styles.flex, { backgroundColor: theme.background }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <MotionPressable style={styles.headerButton} onPress={onClose} disabled={saving}>
            <AppIcon name="back" size={24} color={theme.primary} />
            <Text style={styles.headerButtonText}>返回</Text>
          </MotionPressable>
          <Text style={styles.title}>对话设置</Text>
          <MotionPressable style={styles.saveHeader} onPress={save} disabled={saving}>
            <Text style={styles.saveHeaderText}>{saving ? '保存中' : '保存'}</Text>
          </MotionPressable>
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.sectionTitle}>双方头像</Text>
          <View style={styles.avatarRow}>
            <AvatarEditor
              label="我的头像"
              uri={userAvatarUri}
              fallback="我"
              onPick={() => pickImage('userAvatarUri')}
              onClear={() => setUserAvatarUri(undefined)}
            />
            <AvatarEditor
              label="助手头像"
              uri={assistantAvatarUri}
              fallback="AI"
              onPick={() => pickImage('assistantAvatarUri')}
              onClear={() => setAssistantAvatarUri(undefined)}
            />
          </View>

          <Text style={styles.sectionTitle}>生成参数</Text>
          <View style={styles.parameterRow}>
            <View style={styles.parameterField}>
              <Text style={styles.label}>Temperature</Text>
              <TextInput
                style={styles.input}
                value={temperature}
                onChangeText={setTemperature}
                keyboardType="decimal-pad"
                placeholder="0.7"
                placeholderTextColor={theme.placeholder}
              />
              <Text style={styles.hint}>0 更稳定，2 更发散</Text>
            </View>
            <View style={styles.parameterField}>
              <Text style={styles.label}>Top P</Text>
              <TextInput
                style={styles.input}
                value={topP}
                onChangeText={setTopP}
                keyboardType="decimal-pad"
                placeholder="1"
                placeholderTextColor={theme.placeholder}
              />
              <Text style={styles.hint}>范围 0–1</Text>
            </View>
          </View>

          <Text style={styles.sectionTitle}>背景图片</Text>
          <MotionPressable style={styles.backgroundPicker} onPress={() => pickImage('backgroundImageUri')}>
            {backgroundImageUri ? (
              <Image source={{ uri: backgroundImageUri }} style={styles.backgroundPreview} />
            ) : (
              <View style={styles.backgroundPlaceholder}>
                <AppIcon name="image" size={28} color={theme.textTertiary} />
                <Text style={styles.backgroundPlaceholderText}>选择对话背景</Text>
              </View>
            )}
          </MotionPressable>
          {!!backgroundImageUri && (
            <MotionPressable style={styles.clearButton} onPress={() => setBackgroundImageUri(undefined)}>
              <Text style={styles.clearButtonText}>移除背景图片</Text>
            </MotionPressable>
          )}

          <Text style={styles.sectionTitle}>系统提示词</Text>
          <TextInput
            style={[styles.input, styles.promptInput]}
            value={systemPrompt}
            onChangeText={setSystemPrompt}
            multiline
            textAlignVertical="top"
            placeholder="只对当前对话生效"
            placeholderTextColor={theme.placeholder}
          />

          <View style={styles.switchRow}>
            <View style={styles.switchCopy}>
              <Text style={styles.switchTitle}>自动压缩上下文</Text>
              <Text style={styles.switchHint}>超过约 12k tokens 后，本地压缩旧内容并保留最近约 8k</Text>
            </View>
            <Switch
              value={autoCompressContext}
              onValueChange={setAutoCompressContext}
              trackColor={{ false: theme.border, true: theme.primary }}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function AvatarEditor({
  label,
  uri,
  fallback,
  onPick,
  onClear,
}: {
  label: string;
  uri?: string;
  fallback: string;
  onPick: () => void;
  onClear: () => void;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={styles.avatarEditor}>
      <MotionPressable style={styles.avatarButton} onPress={onPick}>
        {uri ? (
          <Image source={{ uri }} style={styles.avatarImage} />
        ) : (
          <Text style={styles.avatarFallback}>{fallback}</Text>
        )}
      </MotionPressable>
      <Text style={styles.avatarLabel}>{label}</Text>
      {uri ? (
        <MotionPressable onPress={onClear}>
          <Text style={styles.avatarClear}>移除</Text>
        </MotionPressable>
      ) : (
        <Text style={styles.avatarHint}>点击选择</Text>
      )}
    </View>
  );
}

function createStyles(theme: ThemeColors) {
  return StyleSheet.create({
    flex: { flex: 1 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
      backgroundColor: theme.surface,
    },
    headerButton: { flexDirection: 'row', alignItems: 'center', minWidth: 64 },
    headerButtonText: { color: theme.primary, fontSize: 14 },
    saveHeader: { minWidth: 64, alignItems: 'flex-end', paddingVertical: 5 },
    saveHeaderText: { color: theme.primary, fontSize: 14, fontWeight: '600' },
    title: { color: theme.textPrimary, fontSize: 16, fontWeight: '700' },
    content: { padding: 18, paddingBottom: 56 },
    sectionTitle: {
      color: theme.textPrimary,
      fontSize: 15,
      fontWeight: '700',
      marginTop: 18,
      marginBottom: 10,
    },
    avatarRow: { flexDirection: 'row', gap: 28 },
    avatarEditor: { flex: 1, alignItems: 'center' },
    avatarButton: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: theme.primaryLight,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: theme.border,
    },
    avatarImage: { width: '100%', height: '100%' },
    avatarFallback: { color: theme.primary, fontSize: 20, fontWeight: '700' },
    avatarLabel: { color: theme.textPrimary, fontSize: 13, marginTop: 8 },
    avatarHint: { color: theme.textTertiary, fontSize: 11, marginTop: 3 },
    avatarClear: { color: theme.danger, fontSize: 11, marginTop: 3 },
    parameterRow: { flexDirection: 'row', gap: 12 },
    parameterField: { flex: 1 },
    label: { color: theme.textSecondary, fontSize: 12, marginBottom: 5 },
    input: {
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: theme.textPrimary,
      backgroundColor: theme.inputBg,
      fontSize: 14,
    },
    hint: { color: theme.textTertiary, fontSize: 11, marginTop: 4 },
    backgroundPicker: {
      height: 132,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.border,
      overflow: 'hidden',
      backgroundColor: theme.surfaceVariant,
    },
    backgroundPreview: { width: '100%', height: '100%' },
    backgroundPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 },
    backgroundPlaceholderText: { color: theme.textTertiary, fontSize: 13 },
    clearButton: { alignSelf: 'flex-start', paddingVertical: 7 },
    clearButtonText: { color: theme.danger, fontSize: 12 },
    promptInput: { minHeight: 130, maxHeight: 260 },
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginTop: 22,
      padding: 14,
      borderRadius: 12,
      backgroundColor: theme.surfaceVariant,
    },
    switchCopy: { flex: 1 },
    switchTitle: { color: theme.textPrimary, fontSize: 14, fontWeight: '600' },
    switchHint: { color: theme.textTertiary, fontSize: 11, lineHeight: 16, marginTop: 4 },
  });
}
