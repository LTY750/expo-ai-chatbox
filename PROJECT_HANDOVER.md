# 项目交接文档（PROJECT_HANDOVER）

供以后换新对话 / 换 AI 工具继续开发时快速接手。

## 项目目标

自用的手机 AI 聊天客户端，对标 Chatbox：连接多家大模型 API，支持流式对话、
多会话管理、文档解析。数据本地保存，API Key 加密。

## 技术栈

- Expo (React Native) + TypeScript，managed workflow（无 android/ios 原生目录）
- Zustand 状态管理
- expo-sqlite（持久化）+ expo-secure-store（密钥）
- react-native-markdown-display（依赖 punycode polyfill + metro.config.js 别名）
- expo-document-picker / image-picker / file-system / clipboard
- 包管理器：npm

## 当前目录结构

```
chatbox-app/
├── App.tsx                  入口：初始化 + 聊天/设置切换 + 侧边栏
├── index.ts                 注册根组件
├── app.json                 Expo 配置
├── metro.config.js          punycode 别名（Markdown 库必需）
├── tsconfig.json
└── src/
    ├── types.ts             数据模型 Message/Session/Provider/AppSettings/Attachment
    ├── store.ts             Zustand：会话/消息/服务商/流式/解析/自动命名
    ├── settings.ts          设置存取 + 多服务商种子 + 旧配置迁移 + 按服务商存 key
    ├── db/index.ts          SQLite：sessions/messages 表 + kv 表 + 迁移
    ├── platform/index.ts    Platform 抽象（SecureStore 封装）
    ├── providers/
    │   ├── base.ts          BaseProvider 抽象 + buildChatMessages
    │   ├── openai.ts        OpenAI 兼容（streamChat/complete/listModels）
    │   ├── anthropic.ts     Anthropic Messages 协议
    │   ├── factory.ts       按 type 造 Provider 实例
    │   └── siliconflow.ts   仅保留 baseURL 常量
    ├── parse/
    │   ├── index.ts         解析路由：文本本地读 / 图片走 OCR
    │   └── ocr.ts           DeepSeek-OCR（多模态 chat completion）
    └── ui/
        ├── ChatScreen.tsx          聊天主界面 + 消息菜单 + 代码块
        ├── Drawer.tsx              侧边栏（会话列表/改名）
        ├── SettingsScreen.tsx      设置一级页（服务商列表 + OCR + 系统提示词）
        └── ProviderDetailScreen.tsx 服务商详情（获取模型弹窗）
```

<!-- PLACEHOLDER -->

## 已完成的功能

- 多服务商（OpenAI 兼容 / Anthropic），独立 Key + 模型列表，增删改
- 服务商详情页「获取模型」拉取 + 勾选添加
- 流式对话、停止生成、上下文随历史发送
- 会话：新建 / 切换 / 删除 / 重命名 / 标题自动总结
- 消息级：复制 / 编辑重发 / 重新生成 / 删除（长按气泡菜单）
- Markdown 渲染 + 代码块折叠（超 12 行）+ 代码一键复制
- 文档解析：txt/md/csv 本地 + 图片 OCR（DeepSeek-OCR）；解析文本注入上下文
- SecureStore 加密存 Key；旧单服务商配置自动迁移

## 未完成的功能

- 联网搜索（Tavily）
- 助手角色 / Prompt 模板
- 会话搜索、深色模式、字体设置
- 数据导入导出
- LlamaParse（PDF/Word/PPT/Excel）
- RAG 本地知识库
- key 为空时的友好提示（现直接显示服务器 401 原文）

## 核心文件说明

- **store.ts**：全局状态与所有业务动作的中心。`streamReply` 是共享流式逻辑，
  `sendMessage` / `regenerate` / `editAndResend` 复用它。
- **providers/**：每家协议一个类，都实现 streamChat/complete/listModels；
  新增协议只加一个类 + 在 factory 注册。
- **parse/index.ts**：文件读取在 Expo SDK 56 上有权限坑（见下）。
- **settings.ts**：`normalizeSettings` 负责旧配置迁移，改数据结构时注意兼容。

## 当前已知问题 / 注意事项

- **文件读取权限坑（已解决，勿回退）**：DocumentPicker 必须用
  `copyToCacheDirectory: false` 拿 `content://` URI，再用**新 File API**
  `new File(uri).text()` 读；legacy 的 `readAsStringAsync` 硬拒 content scheme，
  copyToCacheDirectory:true 的 file:// 缓存路径新旧 API 都报权限拒绝。
  图片 OCR 的 base64 用 legacy `FS.readAsStringAsync`（image-picker 路径不受限）。
- **同步读文件会冻 UI**：禁止用 `textSync()`，必须异步，否则模拟器 ANR。
- **Markdown 库依赖 punycode**：删 metro.config.js 或 punycode 包会导致打包失败。
- **改原生模块后**：Fast Refresh 不够，需 force-stop Expo Go 重新加载。
- 模型「自我认知」不可靠（会自称 Claude），属 LLM 通病，非 bug。

## 运行方式

```bash
npm install
npm run android      # 或 npm start 后用 Expo Go 扫码
npx tsc --noEmit     # 类型检查
```

调试环境：Android Studio 模拟器（Pixel 7 / API 35）。SDK 默认路径，
环境变量未配，命令里用完整 adb 路径 + `MSYS_NO_PATHCONV=1`。

## 下一步开发建议

优先做**联网搜索（Tavily）**——是立项三大诉求里最后一个，且 Provider 架构已就绪，
做成模型可调用的工具即可。其次补 **key 为空友好提示** 和 **深色模式 / 会话搜索**
这类小体验项。LlamaParse 和 RAG 属重活，可后置。

