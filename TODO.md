# TODO

## 当前目标
开发一个类似 Chatbox 的 AI 聊天客户端（Expo / React Native，手机端）。
> 注：实际技术栈是 Expo / React Native + TypeScript + SQLite，非 Android 原生 + Room。

## 第一版 MVP（已全部完成 ✅）
- [x] 配置 API Key / Base URL / Model（多服务商，Key 存 SecureStore）
- [x] 聊天页面（流式输出 + 停止生成）
- [x] OpenAI-compatible 流式接口（另支持 Anthropic 协议）
- [x] 会话列表（侧边栏）
- [x] 本地保存聊天记录（expo-sqlite，对应模板里的 Room）
- [x] Markdown 渲染（+ 代码块折叠 + 一键复制）
- [x] 删除 / 重命名会话
- [x] 设置页（服务商管理 + OCR + 系统提示词）

## 已超出 MVP 的功能
- [x] 多服务商管理 + 「获取模型」一键拉取
- [x] 对话标题模型自动总结
- [x] 消息级操作：复制 / 编辑重发 / 重新生成 / 删除
- [x] 文档解析：txt/md/csv 本地 + 图片 OCR（DeepSeek-OCR）

## 当前正在做
- 暂无进行中任务（消息级操作刚完成并实测通过）

## 已知问题
- key 为空时直接显示服务器返回的英文 401 原文，缺友好提示
- 模型会自称 Claude（LLM 自我认知不可靠的通病，非 bug）
- 改原生模块后 Fast Refresh 不够，需重启 Expo Go 才生效

## 下一步
- [ ] 联网搜索（Tavily，做成模型可调用的工具）— 立项三大诉求最后一项
- [ ] key 为空的友好提示
- [ ] 深色模式 / 会话搜索 / 字体设置
- [ ] 助手角色 / Prompt 模板
- [ ] 数据导入导出
- [ ] LlamaParse（PDF / Word / PPT 解析）
- [ ] RAG 本地知识库（远期）
