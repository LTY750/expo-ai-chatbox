# Chatbox App

类似 [Chatbox](https://github.com/chatboxai/chatbox) 的多功能 AI 聊天客户端，运行在手机端。
连接 OpenAI / Anthropic / DeepSeek / 硅基流动等大模型 API，统一管理与使用，**不自己训练模型**。

## 项目目标

做一个自用的、接近 Chatbox 核心能力的手机 AI 聊天客户端：多服务商、流式对话、
文档解析、会话管理，数据全部本地保存，API Key 加密存储。

## 技术栈

- **框架**：Expo (React Native) + TypeScript，Expo managed workflow
- **状态管理**：Zustand
- **本地存储**：expo-sqlite（会话 / 消息）+ expo-secure-store（API Key 加密）
- **Markdown**：react-native-markdown-display（+ punycode polyfill）
- **文件 / 图片**：expo-document-picker / expo-image-picker / expo-file-system
- **剪贴板**：expo-clipboard
- **安全区**：react-native-safe-area-context

## 当前已完成功能

- 多服务商管理（OpenAI 兼容 + Anthropic 两种协议），每个服务商独立 Key / 模型列表
- 设置页「获取模型」一键拉取服务商模型列表并勾选添加
- 流式对话、停止生成
- 会话管理：侧边栏新建 / 切换 / 删除 / 重命名，对话标题模型自动总结
- 消息级操作：长按复制 / 编辑重发 / 重新生成 / 删除
- Markdown 渲染 + 代码块折叠 + 代码一键复制
- 文档解析：txt/md/csv 本地读取 + 图片 OCR（DeepSeek-OCR，独立配置）
- 解析内容注入对话上下文
- API Key 加密存储（SecureStore），旧配置自动迁移

## 当前开发状态

核心聊天 + 多服务商 + 文档解析均已完成并在 Android 模拟器实测通过。
处于自用阶段，尚未发布。

<!-- PLACEHOLDER -->

## 安装与运行

```bash
# 安装依赖
npm install

# 启动开发服务器
npm start
# 或直接在 Android 模拟器 / 设备运行
npm run android
```

需要在手机/模拟器安装 **Expo Go**，扫码或通过开发服务器加载。
首次使用进「设置」填写至少一个服务商的 API Key（如硅基流动），图片 OCR 需单独在
「文档解析」区填 OCR 的 baseURL / 模型 / Key。

类型检查：

```bash
npx tsc --noEmit
```

## 后续计划

- 联网搜索（Tavily，做成模型可调用的工具）
- 助手角色 / Prompt 模板
- 会话搜索、深色模式、字体设置
- 数据导入导出
- LlamaParse（PDF / Word / PPT 解析）
- RAG 本地知识库（远期）

## 说明

- API Key 仅存于本机 SecureStore，不进代码、不进 Git。
- 自用项目，纯客户端直连各模型 API；若日后分发，需加 serverless 代理隐藏密钥。

