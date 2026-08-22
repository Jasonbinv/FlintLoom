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

## 非目标

- ACP v2、Streamable HTTP、fs/terminal 客户端能力、permission 弹窗
- 桌面语音 UI、Telegram 语音入站
