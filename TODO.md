# TODO

## 当前目标
开发一个类似 Chatbox 的 AI 聊天客户端（Expo / React Native，手机端）。
> 技术栈：Expo / React Native + TypeScript + SQLite。

## 已完成功能 ✅
- [x] 配置 API Key / Base URL / Model（多服务商，Key 存 SecureStore）
- [x] 聊天页面（流式输出 + 停止生成）
- [x] OpenAI-compatible 流式接口 + Anthropic 协议
- [x] 会话列表（侧边栏）+ 删除 / 重命名 / 标题自动总结
- [x] 本地保存聊天记录（expo-sqlite）
- [x] Markdown 渲染（代码块折叠 + 一键复制）
- [x] 设置页（服务商管理 + OCR + 系统提示词）
- [x] 多服务商管理 +「获取模型」一键拉取
- [x] 消息级操作：复制 / 编辑重发 / 重新生成 / 删除
- [x] 文档解析：txt/md/csv 本地 + 图片 OCR（DeepSeek-OCR）
- [x] **联网搜索（Tavily，模型可调用的工具）** — 立项三大诉求最后一项已完成
- [x] **LlamaParse 文档解析（PDF / Word / PPT / Excel）**
- [x] **深色模式（跟随系统 / 浅 / 深）**
- [x] **LaTeX 数学公式渲染（MathView，webview）**
- [x] **Mermaid 图表渲染（MermaidView，webview）**

## 当前正在做
- 暂无进行中任务

## 已知问题
- key 为空时直接显示服务器返回的英文 401 原文，缺友好提示
- 模型会自称 Claude（LLM 自我认知不可靠的通病，非 bug）
- 改原生模块后 Fast Refresh 不够，需重启 Expo Go 才生效
- Tavily / LlamaParse / 数学公式 / Mermaid 已通过编译与运行，但**功能正确性待配 key 实测**

## 下一步
- [ ] 实测联网搜索（配 Tavily key）、LlamaParse（配 key）、数学公式 / Mermaid 渲染
- [ ] key 为空的友好提示
- [ ] 会话搜索 / 字体设置
- [ ] 助手角色 / Prompt 模板
- [ ] 数据导入导出
- [ ] RAG 本地知识库（远期）

## 开发约定
- 见 AGENTS.md「Git 工作流」：单目录、单 main 分支、只 pull/push、不 force、不重建历史。
- 唯一开发目录：`C:\Users\LTY\Desktop\chatb`
- 远程仓库：https://github.com/LTY750/expo-ai-chatbox
