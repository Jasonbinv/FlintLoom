# 个人微信桥接（方案 1）

通过独立进程把个人微信消息转发到 FlintLoom 已有的 `POST /v1/hooks`，**不修改 host 核心**，也不把非官方协议写进 `@flintloom/kernel`。

```
[个人微信客户端 / 外部转发器 / Wechaty]
        ↓
  @flintloom/wechat-bridge（本包）
        ↓  Bearer hostToken
  FlintLoom POST /v1/hooks
        ↓
  runTurn → 回复文本 → 桥接发回微信
```

> **风险提示**：个人微信没有官方 Bot API。除腾讯 iLink 等正式开放方案外，Wechaty / Hook 类接入均有**封号**可能。请使用**小号**测试，不要用主号。

---

## 前置条件

1. FlintLoom host 已启动（`pnpm desktop` 或单独 `startHost`）
2. 工作区 `flintloom.yml` 已包含 `@flintloom/channel-webhook`（默认 assembly 已带）
3. `~/.flintloom/credentials` 里已有 `hostToken`（首次启动 host 会自动生成）

---

## 快速开始（HTTP 模式，推荐）

HTTP 模式不依赖 Wechaty，适合：

- 本地联调
- 你自己写的微信转发脚本
- iLink / 其它第三方服务 POST 到桥接

```bash
# 终端 1：FlintLoom
pnpm desktop

# 终端 2：桥接（默认 http 模式，端口 7340）
pnpm wechat-bridge
```

模拟一条微信消息：

```bash
curl -s -X POST http://127.0.0.1:7340/v1/inbound \
  -H "Authorization: Bearer $WECHAT_BRIDGE_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"from":"wxid_test","text":"你好"}'
```

响应示例：

```json
{ "ok": true, "reply": "你好！有什么可以帮你？", "parts": ["你好！有什么可以帮你？"] }
```

桥接会把 `sessionId` 设为 `wechat:<from>`（群聊为 `wechat:<roomId>`），并调用：

```http
POST http://127.0.0.1:7331/v1/hooks
Authorization: Bearer <hostToken>
Content-Type: application/json

{ "sessionId": "wechat:wxid_test", "text": "你好" }
```

---

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `FLINTLOOM_HOOK_URL` | `http://127.0.0.1:7331/v1/hooks` | FlintLoom webhook 地址 |
| `FLINTLOOM_HOST_TOKEN` | 读 `~/.flintloom/credentials` | host 鉴权 token |
| `WECHAT_BRIDGE_MODE` | `http` | `http` 或 `wechaty` |
| `WECHAT_BRIDGE_HOST` | `127.0.0.1` | HTTP 监听地址 |
| `WECHAT_BRIDGE_PORT` | `7340` | HTTP 监听端口 |
| `WECHAT_BRIDGE_SECRET` | （空） | 入站 Bearer；建议生产设置 |
| `WECHAT_ALLOWED_FROM` | （空=全部） | 逗号分隔的 wxid / 群 id / `*` |
| `WECHATY_PUPPET` | `wechaty-puppet-wechat4u` | Wechaty puppet 包名 |
| `WECHATY_TOKEN` | （空） | 付费 puppet 的 token |

---

## Wechaty 模式（实验性）

```bash
pnpm add wechaty wechaty-puppet-wechat4u --filter @flintloom/wechat-bridge

$env:WECHAT_BRIDGE_MODE = "wechaty"
$env:WECHAT_ALLOWED_FROM = "wxid_xxx"   # 强烈建议限制来源
pnpm wechat-bridge
```

扫码登录后，私聊/群消息会自动转发到 FlintLoom 并回复。

---

## HTTP 入站 API

| 路径 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 健康检查 |
| `/v1/inbound` | POST | 接收微信消息 |

请求体：

```json
{
  "from": "wxid_sender",
  "text": "用户消息",
  "room": "optional_room@chatroom"
}
```

若设置了 `WECHAT_BRIDGE_SECRET`，请求头需带：

```
Authorization: Bearer <WECHAT_BRIDGE_SECRET>
```

---

## 与 FlintLoom 功能的差异

与 Telegram 通道相同：

- **guard 询问**：非 `host` 通道会当 `deny`，微信里无法点「允许/拒绝」
- **A2UI 组件**：只能回纯文本
- **长回复**：自动按 2000 字分段

---

## 接入外部微信服务

若你已有 iLink / 自研转发器，只需在收到用户消息后 POST 到桥接的 `/v1/inbound`，再把 `reply` 发回微信即可。FlintLoom 侧无需改动。
