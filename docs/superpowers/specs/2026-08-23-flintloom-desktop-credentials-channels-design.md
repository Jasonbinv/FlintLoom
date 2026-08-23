# FlintLoom 桌面凭据、通道设置与本地 guard 设计

日期：2026-08-23  
状态：待审阅  
产品：FlintLoom — A real agent. / 真正的 Agent。  
范围：总 spec **第 35 刀** — 工作台配置 API Key / per-kind 凭据、通道状态、本地 guard 指引。**不**在本片实现新聊天平台（Discord / 飞书等留给第 36 刀）。

## 1. 这是什么

总 spec §4.2 写明密钥按 provider 存在 `~/.flintloom/credentials`；§13 桌面插件/模型页 v1 只读、指向 `.env`。slice 33–34 已支持工作区 `.env` 拆分 `FLINTLOOM_MEDIA_*` / `FLINTLOOM_GUARD_*` 与本地 llama chat，但 **没有桌面表单**，用户仍需手改文件。

本片在 host 上提供 **凭据读写 API**（永不回传完整密钥），桌面新增 **Settings** 页：按 slot 编辑 chat / media / guard / telegram，保存后触发 runtime 重载。Models 页保持只读快照，Settings 负责「怎么配」。

验收：`pnpm desktop` 顶栏可进 Settings；填写 DashScope media key 后 asr 显示已配置；本地 chat + 云端 media 与手改 `.env` 等价；guard 可填本地 `127.0.0.1:8080`；Telegram token + chat ids 写入 credentials 且 poller 生效；`apps/desktop/tests` 与 `apps/host/tests` 绿。

## 2. 方案对比（凭据存哪）

| 方案 | 优点 | 缺点 |
|------|------|------|
| **A. 只写工作区 `.env`** | 与现有文档一致；可进 git 模板 | 桌面写工作区文件需 host 路径权限；多工作区重复配 key；易误提交密钥 |
| **B. 只写 `~/.flintloom/credentials`**（推荐） | 用户级、不进仓库；符合总 spec §4.2；与 `hostToken` 同文件 | 需扩展 JSON schema；与 `.env` 优先级要写清 |
| **C. 双写 `.env` + credentials** | 两边都能用 | 同步复杂、易不一致 |

**决定：B**，`.env` / 进程环境变量 **仍可覆盖** credentials（优先级不变：进程 env > 工作区 `.env` > credentials）。桌面 Settings **只写 credentials**；Models / Settings 提示「若在 `.env` 里已配置，以 `.env` 为准」。

## 3. `credentials` 文件 schema（v2）

路径：`~/.flintloom/credentials`（JSON，与 `hostToken` 共存）。

```json
{
  "hostToken": "…",
  "providers": {
    "chat": {
      "apiKey": "sk-…",
      "baseUrl": "http://127.0.0.1:8080/v1",
      "model": "qwen2.5-1.5b"
    },
    "media": {
      "apiKey": "sk-…",
      "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1"
    },
    "guard": {
      "apiKey": "local",
      "baseUrl": "http://127.0.0.1:8080/v1",
      "model": "qwen2.5-1.5b"
    }
  },
  "channels": {
    "telegram": {
      "token": "123456:ABC…",
      "allowedChatIds": "123456789,-1001234567890"
    }
  }
}
```

规则：

- 缺省字段表示「未在该 slot 存值」；**不**用空字符串抹掉已有 overlay 来源（`.env` 仍可生效）。
- `allowedChatIds` 存 **逗号分隔字符串**（与 `.env` 一致），host 解析逻辑与 `parseTelegramChatIds` 共用。
- 向后兼容：顶层遗留 `chatApiKey` 若存在且 `providers.chat` 无 `apiKey`，视为 `providers.chat.apiKey`（读后可选迁移写入 `providers`）。
- 文件权限：host 写入后保持用户可读（Windows 默认即可）；**禁止**工具 `fs` 读 `credentials`（已有 hidden 名 `credentials` 目录规则；文件名本身不在工作区内）。

## 4. Host：`createRuntime` 合并顺序

在现有 `readDotEnv` + `resolveChatApiKey` 之上扩展 **slot 解析**（不改插件 `apply` 签名）：

| Slot | overlay 目标 | credentials 字段 | 进程 / `.env` 等价（仍优先于 credentials） |
|------|----------------|------------------|---------------------------------------------|
| chat | `models-chat` | `providers.chat` | `FLINTLOOM_API_KEY`, `FLINTLOOM_BASE_URL`, `FLINTLOOM_CHAT_MODEL` |
| media | `models-media` | `providers.media` | `FLINTLOOM_MEDIA_API_KEY`, `FLINTLOOM_MEDIA_BASE_URL` |
| guard | `models-guard` | `providers.guard` | `FLINTLOOM_GUARD_API_KEY`, `FLINTLOOM_GUARD_BASE_URL`, `FLINTLOOM_GUARD_MODEL` |
| telegram | `channel-telegram` | `channels.telegram` | `FLINTLOOM_TELEGRAM_TOKEN`, `FLINTLOOM_TELEGRAM_CHAT_IDS` |

合并逻辑与 slice 33–34 一致：

- 本地 `baseUrl`（`127.0.0.1` / `localhost` / `::1`）时，**不因 chat slot** 自动挂 media/guard；media/guard slot 有独立 apiKey 时仍 overlay。
- `providers.media` 无 `baseUrl` 时默认 DashScope compatible；`providers.guard` 无 `baseUrl` 时默认 DeepSeek compatible（与 slice 34 相同）。

`resolveTelegramOverlay` 扩展：credentials `channels.telegram` 与 env 合并（env 优先）。

## 5. Host HTTP API

均需 `Authorization: Bearer <hostToken>`。

### 5.1 `GET /v1/settings/credentials`

返回各 slot **状态快照**（无完整密钥）：

```json
{
  "slots": [
    {
      "id": "chat",
      "label": "Chat / Omni",
      "configured": true,
      "source": "env",
      "baseUrl": "http://127.0.0.1:8080/v1",
      "model": "qwen2.5-1.5b",
      "maskedKey": "loca…cal"
    },
    {
      "id": "media",
      "label": "Media (ASR/TTS/…)",
      "configured": true,
      "source": "credentials",
      "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
      "maskedKey": "sk-…xxx"
    },
    {
      "id": "guard",
      "label": "Guard",
      "configured": false,
      "source": "none"
    },
    {
      "id": "telegram",
      "label": "Telegram",
      "configured": true,
      "source": "credentials",
      "allowedChatIds": "123456789",
      "maskedKey": "1234…ABC"
    }
  ],
  "webhook": {
    "url": "http://127.0.0.1:7331/v1/hooks",
    "hint": "POST JSON { sessionId, text }；鉴权 Bearer hostToken"
  }
}
```

- `source`：`env` | `credentials` | `none`（表示当前 **生效值** 来自哪一层；env 含进程与工作区 `.env`）。
- `maskedKey`：长度 ≤ 8 显示 `***`；否则首尾各 4 字符 + `…`。
- `webhook` 只读；不存 webhook 密钥（复用 `hostToken`）。

### 5.2 `PUT /v1/settings/credentials/:slotId`

`slotId`：`chat` | `media` | `guard` | `telegram`。

Body（字段均可选；**未出现的字段不修改**）：

```json
{
  "apiKey": "sk-new",
  "baseUrl": "https://…",
  "model": "qwen3.7-plus",
  "allowedChatIds": "123,456"
}
```

- `telegram` 用 `apiKey` 表示 bot token；`allowedChatIds` 字符串。
- 校验：`baseUrl` 若出现须为合法 URL；`allowedChatIds` 非法 → 400，消息含 `allowedChatIds`。
- 写入 `credentials` JSON；**不**改工作区 `.env`。
- 响应：同 `GET` 单 slot 快照 + `reloadApplied: true`（见 5.3）。

### 5.3 `POST /v1/settings/reload`

- 在 **不重启 HTTP 监听** 前提下：`runtime.stop()` → `createRuntime(...)` → 替换 `ctx`。
- 若 `pollChannels` 曾为 true，重载时保持 `pollChannels: true`（Telegram poller 用新 token）。
- 进行中 turn：与 host `close` 相同策略 — `turnBusy` 上的 session 拒绝新 reload 或排队（**决定：有 in-flight turn 时 reload 返回 409**，消息含 `busy`；桌面提示稍后再试）。
- `startHost` / `ensureHost` 内部保存 `workspaceRoot` / `homeDir` / `pollChannels` 以供 reload。

错误：密钥写入失败 500；`Error.message` 与日志 **不得**含 apiKey / token 原文（延续现有 redact）。

## 6. 桌面 Settings UI

### 6.1 导航

顶栏增加 **Settings**（与 Chat / Files / Knowledge / Plugins / Models 同级）。Settings **不**显示右侧 FilePane。

### 6.2 布局

两区块（同一页，非子路由）：

1. **Providers** — 卡片：`chat`、`media`、`guard`
2. **Channels** — 卡片：`telegram` + webhook 只读说明

每卡片字段：

| Slot | 字段 | 控件 |
|------|------|------|
| chat | apiKey, baseUrl, model | password + text |
| media | apiKey, baseUrl | password + text（model 由插件默认） |
| guard | apiKey, baseUrl, model | password + text；副文案「可与 chat 同机 llama-server」 |
| telegram | apiKey(token), allowedChatIds | password + text |

- 打开页时 `GET /v1/settings/credentials`；已配置 slot 显示 `maskedKey` + source pill（`来自 .env` / `来自本机凭据`）。
- **保存** → `PUT` → `POST /v1/settings/reload`；成功 toast「已重载」；409 显示「有对话进行中，请稍后再保存」。
- 空 apiKey 提交：**不**发送 `apiKey` 字段（保留原值）；提供「清除密钥」链接触发 PUT 显式 `apiKey: ""` 删除 credentials 中该字段（删除后回退 `.env`）。

### 6.3 Models 页联动

- `ModelsPane` 底部增加一句：「在 **Settings** 配置密钥」链到 Settings tab。
- 仍 **不**在 Models 页直接编辑 defaultId / 不展示完整密钥。

### 6.4 本地 guard 指引（UX）

Settings guard 卡片固定提示（中文）：

- 本地 chat 时 steward 不会随 chat 自动配置；可填与 chat **同一** llama-server，或更小模型。
- 示例：`baseUrl=http://127.0.0.1:8080/v1`，`apiKey=local`，`model` 与 `/v1/models` 返回 id 一致。
- 链到 `docs/本地llama部署模型.md`（桌面不嵌全文）。

不新增本地 guard provider 实现 — 复用 `@flintloom/models-guard` + overlay。

## 7. 更多 channel（本片 vs 下一刀）

| 通道 | 本片 | 说明 |
|------|------|------|
| desktop / cli | 只读 | 内置，无配置 |
| webhook | 只读 URL + Bearer 说明 | 密钥即 `hostToken` |
| telegram | **可配置** | credentials + reload |
| acp | 只读 | `flint acp` CLI，无 token |
| **Discord / 飞书 / Slack** | **非目标** | 第 36 刀：新 `@flintloom/channel-*` 包，模式抄 telegram |

第 36 刀预备（本文仅记录，不实现）：

- `@flintloom/channel-discord`：Bot token + allowed channel ids，gateway 或 REST 入站，与 telegram 共用 `turnBusy` / `deliver` 模式。
- Settings 增加 discord slot（与 telegram 对称）。

## 8. 文件

| 文件 | 动作 |
|------|------|
| `apps/host/src/credentials.ts` | 新建：读写 schema、mask、merge helpers |
| `apps/host/src/server.ts` | slot 合并、`GET/PUT settings`、`POST reload`、reload 时 `pollChannels` |
| `apps/host/src/token.ts` | 或合并进 credentials.ts；保留 `loadOrCreateToken` |
| `apps/host/tests/server.test.ts` | credentials API、reload、telegram 从 credentials |
| `apps/host/tests/credentials.test.ts` | 可选：纯函数单测 |
| `apps/desktop/src/api.ts` | `fetchCredentialSlots`, `putCredentialSlot`, `reloadSettings` |
| `apps/desktop/src/SettingsPane.tsx` | 新建 |
| `apps/desktop/src/App.tsx` | Settings 导航 |
| `apps/desktop/src/ModelsPane.tsx` | 链到 Settings |
| `apps/desktop/src/app.css` | Settings 表单样式 |
| `apps/desktop/tests/App.test.tsx` | Settings 渲染与 mock API |
| `docs/setup-and-launch.md` | Settings 与 credentials 优先级 |
| `docs/superpowers/specs/2026-08-16-flintloom-design.md` | §16 第 35 项 |

**禁止**：host `import` 新 Loom 包；不改 `runTurn`；不改 `flintloom.yml` 从 UI。

## 9. 失败表

| 情况 | 行为 |
|------|------|
| 无 Bearer | 401 |
| 非法 `slotId` | 404 |
| `allowedChatIds` 非法 | 400，消息含 `allowedChatIds` |
| reload 时 turn busy | 409，消息含 `busy` |
| credentials 文件不可写 | 500，消息不含密钥 |
| `.env` 已配 chat，credentials 也配 chat | 生效值为 `.env`；GET `source: env` |
| 仅 credentials 配 media，chat 为本地 URL | media overlay 生效（slice 34 行为） |
| 清除 credentials chat key，`.env` 无 key | chat 未配置 |

## 10. 验收（自动化）

1. 临时 homeDir：`PUT media` + `reload` → `GET /v1/models` 中 asr `configured: true`。
2. 本地 chat `.env` + credentials media → hybrid 与 slice 34 测试等价。
3. `PUT telegram` + `reload` + `pollChannels` → poller 使用新 token（mock fetch）。
4. `GET` 响应无完整 `sk-` 子串（除 masked 形式）。
5. Desktop：Settings 保存后 Models 页 pill 更新（mock reload 后 refetch models）。

## 11. 非目标

- 编辑 `flintloom.yml`、MCP 行、`flint plugin add` UI
- Models 页改 `defaultId`、provider 营销页
- 新 Discord / 飞书 channel 实现（第 36 刀）
- 把密钥同步进 git 跟踪的 `.env`
- Electron 特有安全存储（仍 JSON 文件）
- CLI `flint config set`（可后续加，本片不做）

## 12. 实现顺序建议（writing-plans 用）

1. `credentials.ts` + `createRuntime` 合并 + host 单测  
2. `GET/PUT/POST reload` HTTP + reload busy 409  
3. Desktop Settings UI + API 客户端 + 测试  
4. 文档与 Models 页链接  

单刀结束：`flint` 与 `pnpm desktop` 均可跑；未打开 Settings 时行为与现网一致。
