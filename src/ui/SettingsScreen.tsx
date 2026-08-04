// 设置页 —— 一级分栏入口 + 各设置二级页
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useChatStore } from '../store';
import {
  getAliyunAccessKeyId,
  getAliyunAccessKeySecret,
  getLlamaParseKey,
  getOcrKey,
  getTavilyKey,
} from '../settings';
import { useTheme, type ThemeColors, type ThemeMode } from '../theme';
import type { AutoTitleMode, DocumentParserProvider, TavilySearchDepth } from '../types';
import ProviderDetailScreen from './ProviderDetailScreen';
import { AppIcon, type AppIconName } from './AppIcon';
import { MotionPressable } from './MotionPressable';
import { MOTION_DURATION, MOTION_EASING } from './motion';
import {
  DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS,
  modelContextKey,
} from '../context';

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
];

type Page =
  | 'home'
  | 'models'
  | 'documents'
  | 'search'
  | 'generation'
  | 'appearance'
  | 'prompt'
  | 'provider-new'
  | `provider:${string}`;

function pageDepth(page: Page): number {
  if (page === 'home') return 0;
  if (page === 'provider-new' || page.startsWith('provider:')) return 2;
  return 1;
}

export default function SettingsScreen({ onClose }: { onClose: () => void }) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [page, setPage] = useState<Page>('home');
  const [pageDirection, setPageDirection] = useState(1);
  const pageAnim = useRef(new Animated.Value(0)).current;

  function navigateTo(next: Page) {
    if (next === page) return;
    setPageDirection(pageDepth(next) >= pageDepth(page) ? 1 : -1);
    setPage(next);
  }

  useEffect(() => {
    pageAnim.setValue(0);
    Animated.timing(pageAnim, {
      toValue: 1,
      duration: MOTION_DURATION.enter,
      easing: MOTION_EASING.enter,
      useNativeDriver: true,
    }).start();
  }, [page, pageAnim]);

  useEffect(() => () => pageAnim.stopAnimation(), [pageAnim]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (page === 'provider-new' || page.startsWith('provider:')) {
        navigateTo('models');
      } else if (page !== 'home') {
        navigateTo('home');
      } else {
        onClose();
      }
      return true;
    });
    return () => subscription.remove();
  }, [page, onClose]);

  const pageAnimatedStyle = {
    opacity: pageAnim,
    transform: [
      {
        translateX: pageAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [pageDirection * 18, 0],
        }),
      },
    ],
  };

  if (page === 'provider-new' || page.startsWith('provider:')) {
    return (
      <Animated.View style={[styles.flex, pageAnimatedStyle]}>
        <ProviderDetailScreen
          providerId={page === 'provider-new' ? null : page.slice('provider:'.length)}
          onBack={() => navigateTo('models')}
        />
      </Animated.View>
    );
  }

  const titleMap: Record<Exclude<Page, 'provider-new' | `provider:${string}`>, string> = {
    home: '设置',
    models: '模型提供商',
    documents: '文档解析',
    search: '联网搜索',
    generation: '生成参数',
    appearance: '外观',
    prompt: '全局提示词',
  };
  const title = titleMap[page as keyof typeof titleMap];

  return (
    <View style={styles.flex}>
      <Header
        title={title}
        onBack={page === 'home' ? onClose : () => navigateTo('home')}
        backText={page === 'home' ? '返回' : '设置'}
      />
      <Animated.View style={[styles.flex, pageAnimatedStyle]}>
        {page === 'home' && <SettingsHome onOpen={navigateTo} />}
        {page === 'models' && (
          <ModelProvidersScreen
            onEdit={(id) => navigateTo(`provider:${id}`)}
            onAdd={() => navigateTo('provider-new')}
          />
        )}
        {page === 'documents' && <DocumentParsingScreen />}
        {page === 'search' && <SearchSettingsScreen />}
        {page === 'generation' && <GenerationSettingsScreen />}
        {page === 'appearance' && <AppearanceScreen />}
        {page === 'prompt' && <PromptScreen />}
      </Animated.View>
    </View>
  );
}

function Header({
  title,
  onBack,
  backText,
}: {
  title: string;
  onBack: () => void;
  backText: string;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={styles.header}>
      <MotionPressable style={styles.headerBack} onPress={onBack} hitSlop={8}>
        <AppIcon name="back" size={24} color={theme.primary} />
        <Text style={styles.headerBtn}>{backText}</Text>
      </MotionPressable>
      <Text style={styles.headerTitle}>{title}</Text>
      <View style={{ width: 54 }} />
    </View>
  );
}

function SettingsHome({ onOpen }: { onOpen: (p: Page) => void }) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const providers = useChatStore((s) => s.settings.providers);
  const currentProviderId = useChatStore((s) => s.settings.currentProviderId);
  const docParser = useChatStore((s) => s.settings.documentParser.provider);
  const temperature = useChatStore((s) => s.settings.temperature);
  const topP = useChatStore((s) => s.settings.topP);
  const autoTitleMode = useChatStore((s) => s.settings.autoTitleMode);
  const tavilySearchDepth = useChatStore((s) => s.settings.tavilySearchDepth);
  const tavilyReady = useChatStore((s) => s.tavilyReady);
  const current = providers.find((p) => p.id === currentProviderId);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <NavRow
        icon="model"
        title="模型提供商"
        subtitle={`${current?.name ?? '未选择'} · ${providers.length} 个服务商`}
        onPress={() => onOpen('models')}
      />
      <NavRow
        icon="document"
        title="文档解析"
        subtitle={docParser === 'aliyun' ? '阿里云文档解析（大模型版）' : 'LlamaParse'}
        onPress={() => onOpen('documents')}
      />
      <NavRow
        icon="search"
        title="联网搜索"
        subtitle={
          tavilyReady
            ? `Tavily 已配置 · ${tavilySearchDepth === 'advanced' ? '高级搜索' : '基础搜索'}`
            : 'Tavily 未配置'
        }
        onPress={() => onOpen('search')}
      />
      <NavRow
        icon="generation"
        title="生成参数"
        subtitle={`温度 ${temperature} · Top P ${topP} · ${autoTitleMode === 'ai' ? 'AI 标题' : '本地标题'}`}
        onPress={() => onOpen('generation')}
      />
      <NavRow icon="appearance" title="外观" subtitle="主题模式" onPress={() => onOpen('appearance')} />
      <NavRow icon="prompt" title="全局提示词" subtitle="系统提示词" onPress={() => onOpen('prompt')} />
    </ScrollView>
  );
}

function NavRow({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: AppIconName;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <MotionPressable style={styles.navRow} onPress={onPress}>
      <View style={styles.navIcon}>
        <AppIcon name={icon} size={21} color={theme.primary} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.rowName}>{title}</Text>
        <Text style={styles.rowSub}>{subtitle}</Text>
      </View>
      <AppIcon name="chevronRight" size={24} color={theme.textTertiary} />
    </MotionPressable>
  );
}

function ModelProvidersScreen({
  onEdit,
  onAdd,
}: {
  onEdit: (id: string) => void;
  onAdd: () => void;
}) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const providers = useChatStore((s) => s.settings.providers);
  return (
    <ScrollView contentContainerStyle={styles.content}>
      {providers.map((p) => (
        <MotionPressable key={p.id} style={styles.navRow} onPress={() => onEdit(p.id)}>
          <View style={styles.navIcon}>
            <AppIcon name="model" size={21} color={theme.primary} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.rowName}>{p.name}</Text>
            <Text style={styles.rowSub}>
              {p.type === 'openai' ? 'OpenAI 兼容' : 'Anthropic'} · {p.models.length} 个模型
            </Text>
          </View>
          <AppIcon name="chevronRight" size={24} color={theme.textTertiary} />
        </MotionPressable>
      ))}
      <MotionPressable style={styles.addProvider} onPress={onAdd}>
        <View style={styles.inlineButton}>
          <AppIcon name="add" size={20} color={theme.primary} />
          <Text style={styles.addProviderText}>添加服务商</Text>
        </View>
      </MotionPressable>
    </ScrollView>
  );
}

function DocumentParsingScreen() {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const settings = useChatStore((s) => s.settings);
  const updateSettings = useChatStore((s) => s.updateSettings);
  const updateOcr = useChatStore((s) => s.updateOcr);
  const saveOcrKey = useChatStore((s) => s.saveOcrKey);
  const saveLlamaParseKey = useChatStore((s) => s.saveLlamaParseKey);
  const saveAliyunDocKeys = useChatStore((s) => s.saveAliyunDocKeys);

  const [parser, setParser] = useState<DocumentParserProvider>(settings.documentParser.provider);
  const [ocrURL, setOcrURL] = useState(settings.ocr.baseURL);
  const [ocrModel, setOcrModel] = useState(settings.ocr.model);
  const [ocrKey, setOcrKey] = useState('');
  const [llamaParseKey, setLlamaParseKey] = useState('');
  const [aliyunKeyId, setAliyunKeyId] = useState('');
  const [aliyunSecret, setAliyunSecret] = useState('');
  const [aliyunEndpoint, setAliyunEndpoint] = useState(settings.documentParser.aliyun.endpoint);
  const [llmEnhancement, setLlmEnhancement] = useState(settings.documentParser.aliyun.llmEnhancement);
  const [enhancementMode, setEnhancementMode] = useState(settings.documentParser.aliyun.enhancementMode);
  const [ossBucket, setOssBucket] = useState(settings.documentParser.aliyun.oss.bucket);
  const [ossEndpoint, setOssEndpoint] = useState(settings.documentParser.aliyun.oss.endpoint);
  const [ossRegion, setOssRegion] = useState(settings.documentParser.aliyun.oss.region);
  const [ossPrefix, setOssPrefix] = useState(settings.documentParser.aliyun.oss.prefix);
  const [aliyunAdvancedOpen, setAliyunAdvancedOpen] = useState(false);
  const [keysLoaded, setKeysLoaded] = useState(false);
  const [keyLoadError, setKeyLoadError] = useState<string | null>(null);
  const [keyLoadAttempt, setKeyLoadAttempt] = useState(0);
  const keyDirtyRef = useRef({ ocr: false, llama: false, aliyunId: false, aliyunSecret: false });
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setKeysLoaded(false);
    setKeyLoadError(null);
    Promise.all([
      getOcrKey(),
      getLlamaParseKey(),
      getAliyunAccessKeyId(),
      getAliyunAccessKeySecret(),
    ])
      .then(([ocr, llama, aliyunId, aliyunKeySecret]) => {
        if (cancelled) return;
        if (!keyDirtyRef.current.ocr) setOcrKey(ocr ?? '');
        if (!keyDirtyRef.current.llama) setLlamaParseKey(llama ?? '');
        if (!keyDirtyRef.current.aliyunId) setAliyunKeyId(aliyunId ?? '');
        if (!keyDirtyRef.current.aliyunSecret) setAliyunSecret(aliyunKeySecret ?? '');
        setKeysLoaded(true);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setKeysLoaded(false);
        setKeyLoadError(`读取密钥失败：${errorMessage(error)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [keyLoadAttempt]);

  async function save() {
    if (saving || !keysLoaded) return;
    setSaving(true);
    setSaveError(null);
    try {
      await updateOcr({ baseURL: ocrURL.trim(), model: ocrModel.trim() });
      if (keyDirtyRef.current.ocr) await saveOcrKey(ocrKey);
      await updateSettings({
        documentParser: {
          provider: parser,
          aliyun: {
            endpoint: aliyunEndpoint.trim() || 'docmind-api.cn-hangzhou.aliyuncs.com',
            llmEnhancement,
            enhancementMode,
            oss: {
              bucket: ossBucket.trim(),
              endpoint: ossEndpoint.trim() || 'oss-cn-hangzhou.aliyuncs.com',
              region: ossRegion.trim() || 'cn-hangzhou',
              prefix: ossPrefix.trim() || 'chatbox-docs/',
              urlExpiresSeconds: 600,
            },
          },
        },
      });
      if (keyDirtyRef.current.llama) await saveLlamaParseKey(llamaParseKey);
      if (keyDirtyRef.current.aliyunId || keyDirtyRef.current.aliyunSecret) {
        await saveAliyunDocKeys(aliyunKeyId, aliyunSecret);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (error: unknown) {
      setSaveError(`保存文档解析设置失败：${errorMessage(error)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {keyLoadError && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{keyLoadError}</Text>
          <Text style={styles.errorHint}>为保护已有密钥，加载成功前不会允许保存。</Text>
          <MotionPressable
            style={styles.retryButton}
            onPress={() => setKeyLoadAttempt((attempt) => attempt + 1)}
          >
            <AppIcon name="retry" size={17} color={theme.primary} />
            <Text style={styles.retryText}>重试加载</Text>
          </MotionPressable>
        </View>
      )}
      <Text style={styles.documentIntro}>
        附件会按类型自动分流。文件使用文档解析服务，图片单独使用视觉 OCR。
      </Text>

      <View style={styles.settingsGroup}>
        <View style={styles.settingsGroupHeader}>
          <View style={styles.settingsGroupIcon}>
            <AppIcon name="document" size={22} color={theme.primary} />
          </View>
          <View style={styles.settingsGroupHeaderText}>
            <Text style={styles.settingsGroupTitle}>文件解析</Text>
            <Text style={styles.settingsGroupDescription}>PDF、Word、PPT、Excel 等办公文档</Text>
          </View>
        </View>

        <Text style={styles.fieldLabel}>选择解析服务</Text>
        <View style={styles.parserOptions}>
          <MotionPressable
            accessibilityRole="radio"
            accessibilityState={{ selected: parser === 'llamaparse' }}
            style={[
              styles.parserOption,
              parser === 'llamaparse' && styles.parserOptionActive,
            ]}
            onPress={() => setParser('llamaparse')}
          >
            <View
              style={[
                styles.parserMark,
                parser === 'llamaparse' && styles.parserMarkActive,
              ]}
            >
              <Text
                style={[
                  styles.parserMarkText,
                  parser === 'llamaparse' && styles.parserMarkTextActive,
                ]}
              >
                LP
              </Text>
            </View>
            <View style={styles.parserOptionBody}>
              <Text style={styles.parserOptionName}>LlamaParse</Text>
              <Text style={styles.parserOptionDescription}>配置简单，直接上传并返回 Markdown</Text>
            </View>
            <View
              style={[
                styles.parserRadio,
                parser === 'llamaparse' && styles.parserRadioActive,
              ]}
            >
              {parser === 'llamaparse' && <View style={styles.parserRadioDot} />}
            </View>
          </MotionPressable>

          <MotionPressable
            accessibilityRole="radio"
            accessibilityState={{ selected: parser === 'aliyun' }}
            style={[styles.parserOption, parser === 'aliyun' && styles.parserOptionActive]}
            onPress={() => setParser('aliyun')}
          >
            <View
              style={[styles.parserMark, parser === 'aliyun' && styles.parserMarkActive]}
            >
              <Text
                style={[
                  styles.parserMarkText,
                  parser === 'aliyun' && styles.parserMarkTextActive,
                ]}
              >
                云
              </Text>
            </View>
            <View style={styles.parserOptionBody}>
              <Text style={styles.parserOptionName}>阿里云文档解析</Text>
              <Text style={styles.parserOptionDescription}>国内服务，需要 OSS 临时中转文件</Text>
            </View>
            <View
              style={[styles.parserRadio, parser === 'aliyun' && styles.parserRadioActive]}
            >
              {parser === 'aliyun' && <View style={styles.parserRadioDot} />}
            </View>
          </MotionPressable>
        </View>

        {parser === 'llamaparse' ? (
          <View style={styles.parserConfig}>
            <Text style={styles.configEyebrow}>LLAMAPARSE 配置</Text>
            <Text style={styles.configTitle}>云端文档解析</Text>
            <Text style={styles.configDescription}>
              适合快速解析常见办公文档，解析结果会以 Markdown 加入对话。
            </Text>
            <Text style={styles.fieldLabel}>API Key</Text>
            <TextInput
              style={[styles.input, (!keysLoaded || saving) && styles.disabled]}
              value={llamaParseKey}
              onChangeText={(value) => {
                keyDirtyRef.current.llama = true;
                setLlamaParseKey(value);
              }}
              placeholder="llx-..."
              placeholderTextColor={theme.placeholder}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              editable={keysLoaded && !saving}
            />
          </View>
        ) : (
          <View style={styles.parserConfig}>
            <Text style={styles.configEyebrow}>阿里云配置</Text>
            <Text style={styles.configTitle}>文档智能（大模型版）</Text>
            <Text style={styles.configDescription}>
              手机文件会临时上传到你的 OSS，解析完成后应用会尝试删除临时文件。
            </Text>

            <Text style={styles.fieldLabel}>AccessKey ID</Text>
            <TextInput
              style={[styles.input, (!keysLoaded || saving) && styles.disabled]}
              value={aliyunKeyId}
              onChangeText={(value) => {
                keyDirtyRef.current.aliyunId = true;
                setAliyunKeyId(value);
              }}
              placeholder="LTAI..."
              placeholderTextColor={theme.placeholder}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              editable={keysLoaded && !saving}
            />
            <Text style={styles.fieldLabel}>AccessKey Secret</Text>
            <TextInput
              style={[styles.input, (!keysLoaded || saving) && styles.disabled]}
              value={aliyunSecret}
              onChangeText={(value) => {
                keyDirtyRef.current.aliyunSecret = true;
                setAliyunSecret(value);
              }}
              placeholder="AccessKey Secret"
              placeholderTextColor={theme.placeholder}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              editable={keysLoaded && !saving}
            />

            <View style={styles.configDivider} />
            <Text style={styles.configSubTitle}>解析增强</Text>
            <MotionPressable style={styles.checkRow} onPress={() => setLlmEnhancement((v) => !v)}>
              <View style={[styles.checkBox, llmEnhancement && styles.checkBoxActive]}>
                {llmEnhancement && <AppIcon name="check" size={15} color="#fff" />}
              </View>
              <View style={styles.checkContent}>
                <Text style={styles.checkText}>启用大模型增强</Text>
                <Text style={styles.checkDescription}>提升复杂版面和内容结构的解析效果</Text>
              </View>
            </MotionPressable>
            {llmEnhancement && (
              <View style={styles.segmentSmall}>
                <MotionPressable
                  style={[styles.segBtn, enhancementMode === '' && styles.segBtnActive]}
                  onPress={() => setEnhancementMode('')}
                >
                  <Text style={[styles.segText, enhancementMode === '' && styles.segTextActive]}>
                    基础链路
                  </Text>
                </MotionPressable>
                <MotionPressable
                  style={[styles.segBtn, enhancementMode === 'VLM' && styles.segBtnActive]}
                  onPress={() => setEnhancementMode('VLM')}
                >
                  <Text
                    style={[
                      styles.segText,
                      enhancementMode === 'VLM' && styles.segTextActive,
                    ]}
                  >
                    VLM 增强
                  </Text>
                </MotionPressable>
              </View>
            )}

            <View style={styles.configDivider} />
            <Text style={styles.configSubTitle}>OSS 文件中转</Text>
            <Text style={styles.configDescription}>Bucket 是阿里云解析手机本地文件的必要配置。</Text>
            <Text style={styles.fieldLabel}>Bucket</Text>
            <TextInput
              style={styles.input}
              value={ossBucket}
              onChangeText={setOssBucket}
              placeholder="chatbox-doc-parser-xxx"
              placeholderTextColor={theme.placeholder}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <MotionPressable
              accessibilityRole="button"
              accessibilityState={{ expanded: aliyunAdvancedOpen }}
              style={styles.advancedToggle}
              onPress={() => setAliyunAdvancedOpen((open) => !open)}
            >
              <View style={styles.advancedToggleLabel}>
                <AppIcon name="settings" size={18} color={theme.textSecondary} />
                <Text style={styles.advancedToggleText}>高级设置</Text>
              </View>
              <AppIcon
                name={aliyunAdvancedOpen ? 'collapse' : 'expand'}
                size={19}
                color={theme.textTertiary}
              />
            </MotionPressable>

            {aliyunAdvancedOpen && (
              <View style={styles.advancedFields}>
                <Text style={styles.fieldLabel}>文档解析 Endpoint</Text>
                <TextInput
                  style={styles.input}
                  value={aliyunEndpoint}
                  onChangeText={setAliyunEndpoint}
                  placeholder="docmind-api.cn-hangzhou.aliyuncs.com"
                  placeholderTextColor={theme.placeholder}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Text style={styles.fieldLabel}>OSS Endpoint</Text>
                <TextInput
                  style={styles.input}
                  value={ossEndpoint}
                  onChangeText={setOssEndpoint}
                  placeholder="oss-cn-hangzhou.aliyuncs.com"
                  placeholderTextColor={theme.placeholder}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Text style={styles.fieldLabel}>Region</Text>
                <TextInput
                  style={styles.input}
                  value={ossRegion}
                  onChangeText={setOssRegion}
                  placeholder="cn-hangzhou"
                  placeholderTextColor={theme.placeholder}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Text style={styles.fieldLabel}>临时文件前缀</Text>
                <TextInput
                  style={styles.input}
                  value={ossPrefix}
                  onChangeText={setOssPrefix}
                  placeholder="chatbox-docs/"
                  placeholderTextColor={theme.placeholder}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
            )}
          </View>
        )}
      </View>

      <View style={styles.settingsGroup}>
        <View style={styles.settingsGroupHeader}>
          <View style={styles.settingsGroupIcon}>
            <AppIcon name="image" size={22} color={theme.primary} />
          </View>
          <View style={styles.settingsGroupHeaderText}>
            <Text style={styles.settingsGroupTitle}>图片文字识别</Text>
            <Text style={styles.settingsGroupDescription}>JPG、PNG、相册图片和扫描截图</Text>
          </View>
        </View>
        <View style={styles.serviceTag}>
          <Text style={styles.serviceTagText}>视觉 OCR · OpenAI 兼容接口</Text>
        </View>
        <Text style={styles.configDescription}>
          图片附件会直接发送给视觉模型提取文字，不使用上面的文件解析服务。
        </Text>
        <Text style={styles.fieldLabel}>API Base URL</Text>
        <TextInput
          style={styles.input}
          value={ocrURL}
          onChangeText={setOcrURL}
          placeholder="https://api.siliconflow.cn/v1"
          placeholderTextColor={theme.placeholder}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Text style={styles.fieldLabel}>OCR 模型</Text>
        <TextInput
          style={styles.input}
          value={ocrModel}
          onChangeText={setOcrModel}
          placeholder="deepseek-ai/DeepSeek-OCR"
          placeholderTextColor={theme.placeholder}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Text style={styles.fieldLabel}>API Key</Text>
        <TextInput
          style={[styles.input, (!keysLoaded || saving) && styles.disabled]}
          value={ocrKey}
          onChangeText={(value) => {
            keyDirtyRef.current.ocr = true;
            setOcrKey(value);
          }}
          placeholder="sk-..."
          placeholderTextColor={theme.placeholder}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          editable={keysLoaded && !saving}
        />
        <Text style={styles.localParseHint}>
          TXT、Markdown、CSV、JSON 等纯文本文件会继续在本地解析。
        </Text>
      </View>

      <MotionPressable
        style={[styles.saveBtn, (!keysLoaded || saving) && styles.disabled]}
        onPress={save}
        disabled={!keysLoaded || saving}
      >
        <View style={styles.inlineButton}>
          <AppIcon name="check" size={19} color="#fff" />
          <Text style={styles.saveText}>
            {saving ? '保存中…' : saved ? '已保存' : '保存解析设置'}
          </Text>
        </View>
      </MotionPressable>
      {saveError && <Text style={styles.saveError}>{saveError}</Text>}
    </ScrollView>
  );
}

function SearchSettingsScreen() {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const settings = useChatStore((s) => s.settings);
  const updateSettings = useChatStore((s) => s.updateSettings);
  const saveTavilyKey = useChatStore((s) => s.saveTavilyKey);
  const [tavilyKey, setTavilyKey] = useState('');
  const [keyLoaded, setKeyLoaded] = useState(false);
  const [keyLoadError, setKeyLoadError] = useState<string | null>(null);
  const [keyLoadAttempt, setKeyLoadAttempt] = useState(0);
  const keyDirtyRef = useRef(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [searchDepth, setSearchDepth] = useState<TavilySearchDepth>(
    settings.tavilySearchDepth
  );

  useEffect(() => {
    let cancelled = false;
    setKeyLoaded(false);
    setKeyLoadError(null);
    getTavilyKey()
      .then((k) => {
        if (cancelled) return;
        if (!keyDirtyRef.current) setTavilyKey(k ?? '');
        setKeyLoaded(true);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setKeyLoaded(false);
        setKeyLoadError(`读取 Tavily API Key 失败：${errorMessage(error)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [keyLoadAttempt]);

  async function save() {
    if (saving || !keyLoaded) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (keyDirtyRef.current) await saveTavilyKey(tavilyKey);
      await updateSettings({ tavilySearchDepth: searchDepth });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (error: unknown) {
      setSaveError(`保存 Tavily 配置失败：${errorMessage(error)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {keyLoadError && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{keyLoadError}</Text>
          <Text style={styles.errorHint}>为保护已有密钥，加载成功前不会允许保存。</Text>
          <MotionPressable
            style={styles.retryButton}
            onPress={() => setKeyLoadAttempt((attempt) => attempt + 1)}
          >
            <AppIcon name="retry" size={17} color={theme.primary} />
            <Text style={styles.retryText}>重试加载</Text>
          </MotionPressable>
        </View>
      )}
      <Text style={styles.section}>Tavily</Text>
      <Text style={styles.hint}>开启聊天页联网搜索后，模型会在需要最新信息时调用 Tavily。</Text>
      <Text style={styles.fieldLabel}>搜索深度</Text>
      <View style={styles.segment}>
        {([
          { value: 'basic', label: '基础 · 1 credit' },
          { value: 'advanced', label: '高级 · 2 credits' },
        ] as const).map((option) => (
          <MotionPressable
            key={option.value}
            style={[styles.segBtn, searchDepth === option.value && styles.segBtnActive]}
            onPress={() => setSearchDepth(option.value)}
            disabled={saving}
          >
            <Text style={[styles.segText, searchDepth === option.value && styles.segTextActive]}>
              {option.label}
            </Text>
          </MotionPressable>
        ))}
      </View>
      <Text style={styles.hint}>基础搜索更省额度；高级搜索适合需要更高相关性的复杂问题。</Text>
      <Text style={styles.fieldLabel}>API Key</Text>
      <TextInput
        style={[styles.input, (!keyLoaded || saving) && styles.disabled]}
        value={tavilyKey}
        onChangeText={(value) => {
          keyDirtyRef.current = true;
          setTavilyKey(value);
        }}
        placeholder="tvly-..."
        placeholderTextColor={theme.placeholder}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        editable={keyLoaded && !saving}
      />
      <MotionPressable
        style={[styles.saveBtn, (!keyLoaded || saving) && styles.disabled]}
        onPress={save}
        disabled={!keyLoaded || saving}
      >
        <View style={styles.inlineButton}>
          <AppIcon name="check" size={19} color="#fff" />
          <Text style={styles.saveText}>
            {saving ? '保存中…' : saved ? '已保存' : '保存 Tavily 配置'}
          </Text>
        </View>
      </MotionPressable>
      {saveError && <Text style={styles.saveError}>{saveError}</Text>}
    </ScrollView>
  );
}

function GenerationSettingsScreen() {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const settings = useChatStore((s) => s.settings);
  const updateSettings = useChatStore((s) => s.updateSettings);
  const [temperature, setTemperature] = useState(String(settings.temperature));
  const [topP, setTopP] = useState(String(settings.topP));
  const [maxTokens, setMaxTokens] = useState(String(settings.maxTokens));
  const [autoTitleMode, setAutoTitleMode] = useState<AutoTitleMode>(settings.autoTitleMode);
  const contextKey = modelContextKey(settings.currentProviderId, settings.currentModel);
  const [contextWindowTokens, setContextWindowTokens] = useState(
    String(settings.modelContextWindows[contextKey] ?? DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS)
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const updateField = (setter: (value: string) => void, value: string) => {
    setter(value.replace(',', '.'));
    setSaved(false);
    setSaveError(null);
  };

  async function save() {
    if (saving) return;
    const temperatureValue = Number(temperature.trim());
    const topPValue = Number(topP.trim());
    const maxTokensValue = Number(maxTokens.trim());
    const contextWindowValue = Number(contextWindowTokens.trim());
    if (!temperature.trim() || !Number.isFinite(temperatureValue) || temperatureValue < 0 || temperatureValue > 2) {
      setSaveError('Temperature 必须是 0 到 2 之间的数字');
      return;
    }
    if (!topP.trim() || !Number.isFinite(topPValue) || topPValue < 0 || topPValue > 1) {
      setSaveError('Top P 必须是 0 到 1 之间的数字');
      return;
    }
    if (!maxTokens.trim() || !Number.isInteger(maxTokensValue) || maxTokensValue < 1 || maxTokensValue > 200000) {
      setSaveError('最大输出 Token 必须是 1 到 200000 之间的整数');
      return;
    }
    if (
      !contextWindowTokens.trim()
      || !Number.isInteger(contextWindowValue)
      || contextWindowValue < 2_048
      || contextWindowValue > 2_000_000
    ) {
      setSaveError('上下文窗口必须是 2048 到 2000000 之间的整数');
      return;
    }
    if (contextWindowValue <= maxTokensValue + 1_024) {
      setSaveError('上下文窗口需要比最大输出 Token 至少多 1024');
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      await updateSettings({
        temperature: temperatureValue,
        topP: topPValue,
        maxTokens: maxTokensValue,
        autoTitleMode,
        modelContextWindows: {
          ...settings.modelContextWindows,
          [contextKey]: contextWindowValue,
        },
      });
      setSaved(true);
    } catch (error: unknown) {
      setSaveError(`保存生成参数失败：${errorMessage(error)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.section}>采样参数</Text>
      <View style={styles.parameterCard}>
        <View style={styles.parameterHeader}>
          <Text style={styles.parameterName}>Temperature</Text>
          <Text style={styles.parameterRange}>0 – 2</Text>
        </View>
        <Text style={styles.hint}>越低越稳定，越高越有创造性；部分服务商最高只接受 1。</Text>
        <TextInput
          style={styles.input}
          value={temperature}
          onChangeText={(value) => updateField(setTemperature, value)}
          placeholder="0.7"
          placeholderTextColor={theme.placeholder}
          keyboardType="decimal-pad"
          editable={!saving}
        />
      </View>

      <View style={styles.parameterCard}>
        <View style={styles.parameterHeader}>
          <Text style={styles.parameterName}>Top P</Text>
          <Text style={styles.parameterRange}>0 – 1</Text>
        </View>
        <Text style={styles.hint}>控制候选词范围。通常只重点调整 Temperature 或 Top P 其中一个。</Text>
        <TextInput
          style={styles.input}
          value={topP}
          onChangeText={(value) => updateField(setTopP, value)}
          placeholder="1"
          placeholderTextColor={theme.placeholder}
          keyboardType="decimal-pad"
          editable={!saving}
        />
      </View>

      <View style={styles.parameterCard}>
        <View style={styles.parameterHeader}>
          <Text style={styles.parameterName}>最大输出 Token</Text>
          <Text style={styles.parameterRange}>1 – 200000</Text>
        </View>
        <TextInput
          style={styles.input}
          value={maxTokens}
          onChangeText={(value) => updateField(setMaxTokens, value.replace(/\D/g, ''))}
          placeholder="4096"
          placeholderTextColor={theme.placeholder}
          keyboardType="number-pad"
          editable={!saving}
        />
      </View>

      <View style={styles.parameterCard}>
        <View style={styles.parameterHeader}>
          <Text style={styles.parameterName}>模型上下文窗口</Text>
          <Text style={styles.parameterRange}>当前模型</Text>
        </View>
        <Text style={styles.hint} numberOfLines={2}>
          {settings.currentModel || '未选择模型'} · 用于估算占用量和自动压缩，不会改变服务商的真实限制。
        </Text>
        <TextInput
          style={styles.input}
          value={contextWindowTokens}
          onChangeText={(value) => updateField(setContextWindowTokens, value.replace(/\D/g, ''))}
          placeholder={String(DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS)}
          placeholderTextColor={theme.placeholder}
          keyboardType="number-pad"
          editable={!saving}
        />
      </View>

      <Text style={styles.section}>对话标题</Text>
      <View style={styles.segment}>
        {([
          { value: 'local', label: '本地生成' },
          { value: 'ai', label: 'AI 生成' },
        ] as const).map((option) => (
          <MotionPressable
            key={option.value}
            style={[styles.segBtn, autoTitleMode === option.value && styles.segBtnActive]}
            onPress={() => {
              setAutoTitleMode(option.value);
              setSaved(false);
            }}
            disabled={saving}
          >
            <Text style={[styles.segText, autoTitleMode === option.value && styles.segTextActive]}>
              {option.label}
            </Text>
          </MotionPressable>
        ))}
      </View>
      <Text style={styles.hint}>
        本地生成不会调用模型；AI 生成会在每个新对话首次回复后额外请求一次当前模型。
      </Text>

      <MotionPressable
        style={[styles.saveBtn, saving && styles.disabled]}
        onPress={save}
        disabled={saving}
      >
        <View style={styles.inlineButton}>
          <AppIcon name="check" size={20} color="#fff" />
          <Text style={styles.saveText}>{saving ? '保存中…' : saved ? '已保存' : '保存生成参数'}</Text>
        </View>
      </MotionPressable>
      {saveError && <Text style={styles.saveError}>{saveError}</Text>}
    </ScrollView>
  );
}

function AppearanceScreen() {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const themeMode = useChatStore((s) => s.themeMode);
  const setTheme = useChatStore((s) => s.setTheme);
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.section}>主题</Text>
      <View style={styles.segment}>
        {THEME_OPTIONS.map((opt) => (
          <MotionPressable
            key={opt.value}
            style={[styles.segBtn, themeMode === opt.value && styles.segBtnActive]}
            onPress={() => setTheme(opt.value)}
          >
            <Text style={[styles.segText, themeMode === opt.value && styles.segTextActive]}>
              {opt.label}
            </Text>
          </MotionPressable>
        ))}
      </View>
    </ScrollView>
  );
}

function PromptScreen() {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const systemPrompt = useChatStore((s) => s.settings.systemPrompt);
  const updateSettings = useChatStore((s) => s.updateSettings);
  const [sp, setSp] = useState(systemPrompt);
  const [saved, setSaved] = useState(false);

  async function save() {
    await updateSettings({ systemPrompt: sp });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.section}>全局系统提示词</Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        value={sp}
        onChangeText={setSp}
        placeholder="例如：你是一个简洁的中文助手"
        placeholderTextColor={theme.placeholder}
        multiline
      />
      <MotionPressable style={styles.saveBtn} onPress={save}>
        <View style={styles.inlineButton}>
          <AppIcon name="check" size={19} color="#fff" />
          <Text style={styles.saveText}>{saved ? '已保存' : '保存提示词'}</Text>
        </View>
      </MotionPressable>
    </ScrollView>
  );
}

function createStyles(theme: ThemeColors) {
  return StyleSheet.create({
    flex: { flex: 1, backgroundColor: theme.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
      backgroundColor: theme.surface,
    },
    headerTitle: { fontSize: 16, fontWeight: '600', color: theme.textPrimary },
    headerBack: { flexDirection: 'row', alignItems: 'center', minWidth: 54 },
    headerBtn: { fontSize: 14, color: theme.primary },
    content: { padding: 16, paddingBottom: 48 },
    section: { fontSize: 13, color: theme.textTertiary, marginTop: 18, marginBottom: 8 },
    navRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 14,
      paddingHorizontal: 14,
      borderWidth: 1,
      borderColor: theme.borderLight,
      borderRadius: 10,
      marginBottom: 8,
      backgroundColor: theme.background,
    },
    navIcon: {
      width: 36,
      height: 36,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.primaryLight,
      marginRight: 12,
    },
    rowName: { fontSize: 15, fontWeight: '600', color: theme.textPrimary },
    rowSub: { fontSize: 12, color: theme.textTertiary, marginTop: 2 },
    chev: { fontSize: 22, color: theme.textTertiary, marginLeft: 8 },
    addProvider: {
      borderWidth: 1,
      borderColor: theme.primary,
      borderStyle: 'dashed',
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: 'center',
      marginTop: 4,
    },
    addProviderText: { color: theme.primary, fontWeight: '600', fontSize: 15 },
    inlineButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
    },
    hint: { fontSize: 12, color: theme.textTertiary, marginBottom: 8, lineHeight: 17 },
    documentIntro: {
      fontSize: 13,
      lineHeight: 20,
      color: theme.textSecondary,
      marginBottom: 2,
    },
    settingsGroup: {
      borderWidth: 1,
      borderColor: theme.borderLight,
      borderRadius: 16,
      padding: 14,
      marginTop: 14,
      backgroundColor: theme.surface,
    },
    settingsGroupHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 4,
    },
    settingsGroupIcon: {
      width: 42,
      height: 42,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.primaryLight,
      marginRight: 11,
    },
    settingsGroupHeaderText: { flex: 1 },
    settingsGroupTitle: { fontSize: 17, fontWeight: '700', color: theme.textPrimary },
    settingsGroupDescription: {
      fontSize: 12,
      lineHeight: 17,
      color: theme.textTertiary,
      marginTop: 2,
    },
    parserOptions: { gap: 9 },
    parserOption: {
      minHeight: 70,
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 12,
      paddingHorizontal: 11,
      paddingVertical: 10,
      backgroundColor: theme.inputBg,
    },
    parserOptionActive: {
      borderColor: theme.primary,
      backgroundColor: theme.primaryLight,
    },
    parserMark: {
      width: 38,
      height: 38,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.surfaceVariant,
      marginRight: 10,
    },
    parserMarkActive: { backgroundColor: theme.primary },
    parserMarkText: { fontSize: 13, fontWeight: '800', color: theme.textSecondary },
    parserMarkTextActive: { color: '#fff' },
    parserOptionBody: { flex: 1, paddingRight: 8 },
    parserOptionName: { fontSize: 15, fontWeight: '700', color: theme.textPrimary },
    parserOptionDescription: {
      fontSize: 12,
      lineHeight: 17,
      color: theme.textSecondary,
      marginTop: 2,
    },
    parserRadio: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 1.5,
      borderColor: theme.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    parserRadioActive: { borderColor: theme.primary },
    parserRadioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: theme.primary },
    parserConfig: {
      marginTop: 14,
      padding: 13,
      borderRadius: 12,
      backgroundColor: theme.surfaceVariant,
    },
    configEyebrow: {
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 0.7,
      color: theme.primary,
      marginBottom: 3,
    },
    configTitle: { fontSize: 16, fontWeight: '700', color: theme.textPrimary },
    configDescription: {
      fontSize: 12,
      lineHeight: 18,
      color: theme.textSecondary,
      marginTop: 4,
    },
    configDivider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: theme.border,
      marginTop: 16,
      marginBottom: 13,
    },
    configSubTitle: { fontSize: 14, fontWeight: '700', color: theme.textPrimary },
    checkContent: { flex: 1 },
    checkDescription: {
      fontSize: 12,
      lineHeight: 17,
      color: theme.textTertiary,
      marginTop: 1,
    },
    advancedToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: 44,
      marginTop: 12,
      paddingHorizontal: 11,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 10,
      backgroundColor: theme.inputBg,
    },
    advancedToggleLabel: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    advancedToggleText: { fontSize: 13, fontWeight: '600', color: theme.textSecondary },
    advancedFields: {
      marginTop: 10,
      paddingTop: 2,
    },
    serviceTag: {
      alignSelf: 'flex-start',
      borderRadius: 999,
      paddingHorizontal: 9,
      paddingVertical: 5,
      marginTop: 12,
      backgroundColor: theme.primaryLight,
    },
    serviceTagText: { fontSize: 11, fontWeight: '700', color: theme.primary },
    localParseHint: {
      fontSize: 12,
      lineHeight: 18,
      color: theme.textTertiary,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.border,
      marginTop: 15,
      paddingTop: 12,
    },
    errorBox: {
      borderWidth: 1,
      borderColor: theme.danger,
      borderRadius: 10,
      padding: 10,
      marginBottom: 8,
    },
    errorText: { color: theme.danger, fontSize: 13, lineHeight: 18 },
    errorHint: { color: theme.textTertiary, fontSize: 12, lineHeight: 17, marginTop: 4 },
    retryText: { color: theme.primary, fontWeight: '600' },
    retryButton: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    fieldLabel: { fontSize: 13, fontWeight: '600', marginTop: 12, marginBottom: 6, color: theme.textPrimary },
    input: {
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      color: theme.textPrimary,
      backgroundColor: theme.inputBg,
    },
    multiline: { minHeight: 120, textAlignVertical: 'top' },
    parameterCard: {
      borderWidth: 1,
      borderColor: theme.borderLight,
      borderRadius: 14,
      padding: 14,
      marginBottom: 12,
      backgroundColor: theme.surface,
    },
    parameterHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 6,
    },
    parameterName: { fontSize: 15, fontWeight: '700', color: theme.textPrimary },
    parameterRange: { fontSize: 12, color: theme.textTertiary },
    segment: {
      flexDirection: 'row',
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 10,
      overflow: 'hidden',
    },
    segmentSmall: {
      flexDirection: 'row',
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 10,
      overflow: 'hidden',
      marginTop: 8,
    },
    segBtn: { flex: 1, paddingVertical: 10, alignItems: 'center' },
    segBtnActive: { backgroundColor: theme.primary },
    segText: { fontSize: 14, color: theme.textPrimary },
    segTextActive: { color: '#fff', fontWeight: '600' },
    checkRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 12,
      marginTop: 2,
    },
    checkBox: {
      width: 22,
      height: 22,
      borderRadius: 7,
      borderWidth: 1,
      borderColor: theme.border,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 8,
    },
    checkBoxActive: { backgroundColor: theme.primary, borderColor: theme.primary },
    checkText: { fontSize: 14, color: theme.textPrimary },
    saveBtn: {
      backgroundColor: theme.primary,
      borderRadius: 10,
      paddingVertical: 14,
      alignItems: 'center',
      marginTop: 24,
    },
    saveText: { color: '#fff', fontSize: 16, fontWeight: '600' },
    saveError: { color: theme.danger, fontSize: 13, lineHeight: 18, marginTop: 10 },
    disabled: { opacity: 0.5 },
  });
}
