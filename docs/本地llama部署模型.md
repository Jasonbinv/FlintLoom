# 本地 llama.cpp + FlintLoom

FlintLoom 通过 **OpenAI 兼容 HTTP API** 连模型，不能直接把 GGUF 路径写进 `.env`。需先用 `llama-server` 提供 `/v1/chat/completions`。

## 1. 启动 llama-server

```powershell
.\llama-server.exe `
  -m "G:\llama\models\Qwen2.5-1.5B\qwen2.5-1.5b-instruct-q4_k_m.gguf" `
  --alias "qwen2.5-1.5b" `
  --host 127.0.0.1 `
  --port 8080 `
  -ngl 99 `
  -c 8192 `
  --chat-template qwen2 `
  -np 1
```

RTX 3070 Ti（8GB）建议：**`-ngl 99` + `-c 8192` + `-np 1`**。与 Electron 同时开显存紧时改为 `-c 4096`。

查模型 id（`FLINTLOOM_CHAT_MODEL` 需与之一致）：

```powershell
curl.exe http://127.0.0.1:8080/v1/models
```

若返回 `id` 为完整路径，`.env` 里 `FLINTLOOM_CHAT_MODEL` 填该路径；若用了 `--alias`，可填别名。

## 2. FlintLoom `.env`

在工作区 `FlintLoom/.env`：

```env
FLINTLOOM_BASE_URL=http://127.0.0.1:8080/v1
FLINTLOOM_API_KEY=local
FLINTLOOM_CHAT_MODEL=G:\llama\models\Qwen2.5-1.5B\qwen2.5-1.5b-instruct-q4_k_m.gguf
```

或（使用 `--alias` 时）：

```env
FLINTLOOM_CHAT_MODEL=qwen2.5-1.5b
```

注释掉云端 `FLINTLOOM_BASE_URL` / `FLINTLOOM_API_KEY`，避免混用。

改完后重启 `pnpm desktop:app`。

## 3. Host 行为（本地 URL）

当 `FLINTLOOM_BASE_URL` 指向 `127.0.0.1` / `localhost` 时，host **只 overlay 文本 chat/omni**，不会 overlay：

- `models-media`（asr / tts / 图片等）
- `models-guard`（steward）

因此 Models 页媒体 kind 显示「未配置」、顶栏无 guard pill 是预期行为。若需语音/图片，可额外配置：

```env
FLINTLOOM_MEDIA_API_KEY=sk-你的DashScope密钥
FLINTLOOM_MEDIA_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
```

可选 guard（与本地 chat 分开）：

```env
FLINTLOOM_GUARD_API_KEY=sk-xxx
FLINTLOOM_GUARD_BASE_URL=https://api.deepseek.com/v1
FLINTLOOM_GUARD_MODEL=deepseek-chat
```

## 4. 自测

```powershell
cd G:\AgentCode\PerAgent\FlintLoom
pnpm flint "你好"
```

顶栏应显示 **chat 已配置**。
