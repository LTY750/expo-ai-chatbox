# TODO

## 当前目标
开发一个类似 Chatbox 的 AI 聊天客户端（Expo / React Native，手机端）。
> 技术栈：Expo / React Native + TypeScript + SQLite。

## 已完成功能 ✅
- [x] 配置 API Key / Base URL / Model（多服务商，Key 存 SecureStore）
- [x] 聊天页面（流式输出 + 停止生成）
- [x] OpenAI-compatible 流式接口 + Anthropic 协议
- [x] 会话列表（侧边栏）+ 删除 / 重命名 / 本地标题（可选 AI 总结）
- [x] 本地保存聊天记录（expo-sqlite）
- [x] Markdown 渲染（代码块折叠 + 一键复制）
- [x] 设置页分栏（模型提供商 / 文档解析 / 联网搜索 / 外观 / 全局提示词）
- [x] 多服务商管理 +「获取模型」一键拉取
- [x] 消息级操作：复制 / 编辑重发 / 重新生成 / 删除
- [x] 文档解析：txt/md/csv 本地 + 图片 OCR（DeepSeek-OCR）
- [x] **联网搜索（Tavily / Bocha，模型可调用的工具）** — 立项三大诉求最后一项已完成
- [x] **LlamaParse 文档解析（PDF / Word / PPT / Excel）**
- [x] **纯文本本地优先 + LlamaParse 回退（PDF / Word / PPT / Excel）**
- [x] **深色模式（跟随系统 / 浅 / 深）**
- [x] **LaTeX 数学公式渲染（MathView，webview）**
- [x] **Mermaid 图表渲染（MermaidView，webview）**
- [x] Tavily basic / advanced 搜索深度与额度提示（默认 basic）
- [x] 每个服务商/模型独立上下文窗口 + 估算占用量 + 动态压缩预算
- [x] Key 为空的中文前置提示（聊天、解析、获取模型、单模型测试）

## 当前正在做
- 暂无进行中任务

## 已知问题
- 模型会自称 Claude（LLM 自我认知不可靠的通病，非 bug）
- 改原生模块后 Fast Refresh 不够，需重启 Expo Go 才生效
- Tavily / Bocha / LlamaParse 已通过编译，但**功能正确性待配 key 实测**

## 下一步
- [ ] 实测联网搜索（配 Tavily 或 Bocha key）和 LlamaParse（配 Llama Cloud key）
- [ ] 字体设置
- [ ] 助手角色 / Prompt 模板
- [ ] 数据导入导出
- [ ] RAG 本地知识库（远期）

## 开发约定
- 见 AGENTS.md「Git 工作流」：单目录、单 main 分支、只 pull/push、不 force、不重建历史。
- 唯一开发目录：`C:\Users\LTY\Desktop\chatb`
- 远程仓库：https://github.com/LTY750/expo-ai-chatbox
