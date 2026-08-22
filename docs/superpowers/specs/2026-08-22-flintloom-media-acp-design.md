# FlintLoom 媒体 Provider 与 ACP 通道设计

日期：2026-08-22  
状态：已审阅  
范围：总 spec 第 16–18 刀。

## 16. `@flintloom/models-media`

- 扩展 `ModelRegistry`：`registerAsr` / `registerTts` / `registerT2i` / `registerT2v` / `registerOmni` 与 `resolve*`
- DashScope 原生 API（与 chat compatible-mode 分离）：`t2i`、`tts`、`asr`；`t2v` 首版占位（未配则 `ModelKindMissingError`）
- 与 `models-chat` 共用 `FLINTLOOM_API_KEY`；host `createRuntime` overlay `models-media`

## 17. `@flintloom/media-tools`

- 工具 `image_generate`（`resolveT2i`，产物写入工作区）
- 工具 `video_generate`（`resolveT2v`，同上）
- 未配置对应 kind 时工具返回可读错误，不回落到 `chat`

## 18. `@flintloom/channel-acp` + `flint acp`

- FlintLoom 作为 **ACP Agent**：JSON-RPC newline stdio（v1）
- 实现：`initialize`、`session/new`、`session/prompt`（纯文本）、`session/cancel`
- `session/prompt` → `runTurn({ channel: "acp" })`；`assistant/chunk` → `session/update` `agent_message_chunk`
- 日志写 `stderr`；`stdout` 仅 ACP 消息
- yml 挂 `@flintloom/channel-acp`；CLI `pnpm flint acp` 启动

## 19. ACP `tool_call` 推送

- `tool/call` → `session/update` `tool_call`（`pending`）+ `tool_call_update`（`in_progress`）
- `tool/result` → `tool_call_update`（`completed` / `failed`）；工具名映射 ACP `kind`（`fs`/`grep`/`shell` 等）
- 非目标：`session/request_permission`（guard ask 仍仅 host channel）

## 20. 语音 ASR 入站

- Host：`POST /v1/asr`（raw audio + `Content-Type`）；Bearer 鉴权；未配 asr → 503
- 桌面：composer「语音」按钮（`MediaRecorder` → `/v1/asr` → 填入输入框）；`asr.configured` 控制显示
- Telegram：`message.voice` → `getFile` 下载 ogg → `resolveAsr().transcribe` → 现有 `channels.inbound` 文本路径

## 21. T2V 异步任务轮询

- DashScope 文生视频返回 `task_id` 时：`GET /api/v1/tasks/{task_id}` 轮询至 `SUCCEEDED` / `FAILED`
- 默认间隔 15s、最长等待 10 分钟；`signal` 取消即中止
- `SUCCEEDED` 后从 `output.video_url` 下载 MP4；`video_generate` 工具无需改动

## 22. TTS 出站

- Host：`POST /v1/tts` JSON `{ text }` → raw audio；未配 tts → 503
- 桌面：助手气泡「朗读」按钮（`tts.configured`）
- Telegram：`deliver` / `send` 在 TTS 已配置时优先 `sendVoice`，失败回退文本

## 23. ACP `session/request_permission`

- guard `ask` + `channel === "acp"`：Agent 向 Client 发 `session/request_permission`
- `allow-once` / `reject-once` → `continueGuardTurn`；`cancelled` → 取消 turn
- stdio 双向 JSON-RPC：`AcpClientRpc` 等待 Client 响应

## 24. 知识库 embedding / rerank

- `ModelRegistry`：`embedding` / `rerank` provider（DashScope 兼容 embeddings + 原生 rerank）
- 入库时写入向量；检索优先向量相似度，未配则 FTS/LIKE
- 可选 rerank 对 top 命中重排；`knowledge_search` 接口形状不变

## 25. omni 消费者

- `models-chat` 同时登记 `omni`（默认同 chat 模型或 `omniModel`）
- loop `runStepIterations`：omni 已配置时 `resolveOmni()` 替代 `resolveChat()`

## 26. 图片入站 + omni 多模态消息

- session：`user/message` 可选 `images: { mime, data }[]`（base64）；`deriveMessages` 投影为 OpenAI 多模态 content parts
- `models-chat` OpenAI 兼容层：`image_url` data URL
- Host：`POST /v1/turns` JSON 可选 `images`；未配 omni 时仍可记 log，由模型层失败
- 桌面：`omni.configured` 时 composer「图片」按钮；发送时带 `images`
- Telegram：`message.photo` → 下载最大尺寸 → omni 已配置时 `inbound` 带图；未配则忽略（与 voice 无 asr 一致）

## 27. Guard steward + `@flintloom/models-guard`

- `GuardProvider.steward`：工具成功执行后 loop 写 `guard/steward`（`ok` / `suspicious` + summary），再写 `tool/result`
- `guard denied` 结果不 steward；steward 失败不阻断 turn
- `@flintloom/models-guard`：OpenAI 兼容非流式分类；`gate` + `steward`；host overlay 与 chat 共用 API key
- v1 不自动卸插件、不改工具登记

## 28. ACP 多模态 prompt

- `initialize.promptCapabilities`：`omni` → `image` + `embeddedContext`；`asr` → `audio`
- `session/prompt` 块：`text`、`image`（mime + base64）、`audio`（ASR 转写并入 text）、`embedded_context`（text）
- `runTurn` 带 `images` 与 slice 26 一致

## 非目标

- ACP v2、Streamable HTTP、fs/terminal 客户端能力
