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

## 非目标

- ACP v2、Streamable HTTP、fs/terminal 客户端能力、permission 弹窗
- omni 消费者
