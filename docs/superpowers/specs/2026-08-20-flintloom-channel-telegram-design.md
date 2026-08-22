# FlintLoom Telegram 通道切片设计

日期：2026-08-20  
状态：待审阅（复核修订）  
产品：FlintLoom — A real agent. / 真正的 Agent。  
范围：总 spec 第四刀的 **Telegram 第二片**。yml 挂上 `@flintloom/channel-telegram` 后，仅 `startHost` 对 Bot API 做 `getUpdates` 长轮询；白名单内的纯文本经 `ctx.channels.inbound("telegram")` 调同一套 `runTurn`，再用 `sendMessage` 把本 turn 文本发回同一 chat。禁止再往 `createRuntime` 里 `register`。Host **不** 新增 HTTP 路由，**不** `import` 本包。`packages/channel` **不** 增加 `send` / `deliver`。

## 1. 这是什么

用户把个人 Agent 的 Telegram bot 配进工作区 yml。工作台 host 起来之后，对该 bot 的允许 chat 发一句文本，等到这一轮 turn 结束，同一 chat 收到回复文本。session log 与工作台 turn 使用同一套 `runTurn` 事件。Telegram 侧没有 A2UI 树、没有 SSE。

验收：yml 含 `channel` + `channel-telegram`（`id` 必须是这两个字面量），`config.token` 与非空 `allowedChatIds` 合法；`pnpm desktop` / `startHost` 后对该 chat 发纯文本能收到 `lastAssistantText` 的回复。同一 `sessionId` 上工作台正在跑 turn 或 `awaiting_action` 时，再发 Telegram 只 ack、不开第二轮、不回复。`flint`（两参 `createRuntime`）即使 yml 有本插件也不轮询。假 `ChatProvider`、**同一 `text` 字符串**、无 A2UI wait 时，`inbound` 写出的事件与 `runTurn({ channel: "host" })` 同构（见 9.3）。自动化测试不打 `api.telegram.org`、不依赖真实 API key。

同构 **不是**「Telegram HTTP 与 `/v1/turns` 同一 body」。入站文本是 `message.text` trim 后的结果。

## 2. 复核后收紧的决策

| 点 | 决定 |
|---|---|
| 入站传输 | 插件 `getUpdates` 长轮询。不对 Telegram 开公网 webhook。Host 仍只绑 `127.0.0.1`。不新增 `/v1/*` 路由。 |
| 谁启动 poll | **仅** `startHost` → `createRuntime(workspaceRoot, homeDir, { pollChannels: true })` overlay `{ workspaceRoot, poll: true }`。CLI `createRuntime(workspaceRoot, homeDir)` **不** overlay，不轮询。`apply` 本身不无条件 poll。 |
| 停轮询 | `createRuntime` **必须**保留 `applyConfig` 的 disposer，作为 `Runtime.stop`。现网丢掉它；本片不改则 `host.close` 关不掉 getUpdates，测试与进程会挂住。`startHost().close` 顺序：`closeAllConnections` → `runtime.stop()` → `server.close`。CLI 在 `process.exit` 前调用 `stop()`。 |
| 密钥 | `token` 只在该插件 yml `config`。永不进 session 事件、工具参数、`Error.message`、轮询日志。不读 `TELEGRAM_BOT_TOKEN`，不放 `~/.flintloom/credentials`。 |
| 白名单 | `allowedChatIds` **必填且非空**。不在名单内的 update **ack 并忽略**，不 inbound、不 `sendMessage`。没有「未配置则全放行」。 |
| 配置失败 | `token` 空/非 string，或 `allowedChatIds` 空/非法 → `apply` **抛错**，host / `createRuntime` 起不来。`Error.message` 分别含 `token` 或 `allowedChatIds`。 |
| `sessionId` | `` `telegram:${chatId}` ``。`chatId` 是 `message.chat.id` 的十进制字符串（群聊负数原样拼接，例如 `telegram:-100123`）。调用方不能另选 session。 |
| 入站内容 | 只处理 `message.text`。trim 后长度为 0 → ack 忽略。`edited_message`、callback、贴纸、照片、caption、频道帖一律 ack 忽略。本片不落工作区文件。 |
| 出站 | 适配器 **不** 调 Bot API。poller 在 `inbound` 返回后对同一 `chat.id` `sendMessage`。本片 **不** 实现 `channels.send`。不设 `parse_mode`。 |
| 回复文本 | 与 webhook 相同：本 turn 最后一条 `assistant/message` 的 `text`；没有则为 `""`。`""` **不** 调用 `sendMessage`（Bot API 拒绝空文本）。长度 > 4096 时按 JS 字符串 `slice(0, 4096)` 截断，不拆条。 |
| A2UI | `channel === "telegram"` **不** 因 `a2ui_emit` wait 暂停。不把 A2UI 树发到 Telegram。loop 保持 `channel === "host"` 才暂停。 |
| 冲突 | 与 host HTTP **共用** `ctx` 上的 per-session `turnBusy`。该 `sessionId` 已 busy，或 `sessionHasWaitingTurn` 为真 → **ack、不 inbound、不 sendMessage**（静默，不回「忙」）。不同 chat（不同 sessionId）可以并行。 |
| 同 chat 连发 | 已有 in-flight（busy）则 ack 丢弃，**不排队**。 |
| 取消 | telegram turn **不** 写入 `controllers` / `turns`。`POST /v1/turns/:id/cancel` → **404**。host `close` / 插件 dispose  abort poll 与该次 inbound 的 `signal`。 |
| 超时 | **不加** turn deadline。`getUpdates` 的 Bot `timeout` 为 **30**。 |
| 启动清队列 | poll 循环开始前先 `deleteWebhook` 且 `drop_pending_updates: true`（成功一次即可）。然后才 `getUpdates`。作用：丢掉停机积压，避免 offset=0 把旧消息全部跑成 turn；并清掉曾 `setWebhook` 的 bot，否则 getUpdates 会一直失败。崩溃后重启 **丢积压**（可能丢正在处理的那条），不重放。 |
| 默认 yml | 仓库根 `flintloom.yml` 与 host `ASSEMBLY` **不** 加 telegram 行。没有 token 的行会让开机失败。 |
| Host 边界 | Host **禁止** import `@flintloom/channel-telegram` / `createTelegramAdapter`。允许从 `@flintloom/channel` **只导入类型**。Host **禁止** 为 telegram 调用 `runTurn`。 |
| SDK | 不引入 grammy / telegraf / 其它 Telegram 库。`fetch` 调 Bot HTTP。 |

## 3. 非目标

- 附件、语音、caption、文件落工作区、DocForge 入站
- Telegram 公网 webhook、对公网端口
- `ctx.channels.send` / `deliver`
- 把 telegram turn 接到 `POST /v1/turns/:id/cancel`
- `/start` `/stop` 专用命令、inline keyboard、callback_query
- 持久化 `getUpdates` offset（每次启动 `deleteWebhook` 丢积压，不靠落盘）
- 默认装配里预置 bot token
- ACP、Slack / Discord / 邮件 / 飞书
- `flint plugin add`
- 改桌面 UI、改 A2UI catalog、改 DocForge 工具
- 引入 dataagent-v3 / deepseek-harness / Cordis

## 4. 架构

```text
flintloom.yml
  … loop
  - id: channel
    name: "@flintloom/channel"
  - id: channel-telegram
    name: "@flintloom/channel-telegram"
    config:
      token: "…"
      allowedChatIds: [123]

createRuntime(workspaceRoot, homeDir)
  ctx.provide("turnBusy", new Set())
  applyConfig → 保留 disposer 为 Runtime.stop
  无 poll overlay → 只登记适配器，不 getUpdates

startHost
  createRuntime(..., { pollChannels: true })
  overlay id "channel-telegram": { workspaceRoot, poll: true }
  close: closeAllConnections → runtime.stop() → server.close

apply @flintloom/channel-telegram
  校验 token / allowedChatIds
  register("telegram", adapter)
  poll === true → effect 启动 poller
                 dispose → abort

poller
  先 deleteWebhook { drop_pending_updates: true }（失败 1s 重试）
  再循环 getUpdates (timeout=30, allowed_updates=["message"])
  每个有效 update_id：offset = update_id+1（ack）
  过滤白名单 + message.text trim
  sessionId = "telegram:" + chat.id
  busy 或 awaiting_action → 停止（已 ack）
  否则 busy.add（无 await）
        后台 inbound("telegram", { text, sessionId, workspaceRoot, signal })
        返回后 sendMessage（空 text 则跳过）
        finally busy.delete

adapter
  sessions.getOrCreate(sessionId)
  loop.runTurn({ channel: "telegram", 无 onEvent })
  lastAssistantText（本包）
```

Flint 拥有：`127.0.0.1` listen、hostToken、HTTP 三路仍走同一把 `turnBusy`；`startHost` 才打开 `pollChannels`。  
Loom 拥有：`channels` 登记表、telegram 适配器、getUpdates / sendMessage、`runTurn`、session log。

host **禁止**为 telegram 调用 `runTurn`。host **禁止** import `@flintloom/channel-telegram`。

Webhook 的 HTTP 契约不变：`POST /v1/turns` / `actions` / `hooks` 仍按 [webhook 通道设计](2026-08-20-flintloom-channel-webhook-design.md) 做 409。本片只把那把 `Set` 从 `startHost` 闭包挪到 `ctx.require("turnBusy")`，让 poller 能看见工作台 in-flight。

## 5. 组件

### 5.1 `@flintloom/channel`

本片 **不** 改 `ChannelInbound` / `ChannelRegistry` 形状，**不** 加 `send`。禁止先留空方法再抛 `not implemented`。

yml 行必须在 `channel-telegram` **之前**。`channel-telegram` 的 `apply` 开头 `ctx.require("channels")`。

### 5.2 `turnBusy`

服务键：`"turnBusy"`。值：`Set<string>`，元素为 `sessionId`。

`createRuntime` 在 `applyConfig` **之前**：

```ts
ctx.provide("turnBusy", new Set<string>());
```

CLI 与 host 都会 provide；只有 host HTTP 与 telegram poller 写入。

`startHost` 不再 `new Set()`。`handleRequest` 的 `opts.busy` 必须是 `runtime.ctx.require<Set<string>>("turnBusy")`（或等价：从同一 Set 传入）。检查与 `add` 之间不得 `await`。`delete` 仍在 **try/finally**。

webhook 三路何时 add/delete 的表 **原样保持**（见 webhook spec 5.3）。telegram poller 另见 5.4。

### 5.3 `@flintloom/channel-telegram` 插件

```ts
{
  name: "@flintloom/channel-telegram",
  apply(ctx, config) {
    const channels = ctx.require<ChannelRegistry>("channels");
    ctx.require("sessions");
    ctx.require("loop");
    const parsed = parseTelegramConfig(config); // 失败则 throw
    ctx.effect(channels.register("telegram", createTelegramAdapter(ctx)));
    if (parsed.poll) {
      ctx.require<Set<string>>("turnBusy");
      ctx.effect(startTelegramPoller(ctx, parsed));
    }
  },
}
```

`parseTelegramConfig`：

| 字段 | 规则 |
|---|---|
| `token` | 必须是 length > 0 的 string，否则 `throw new Error("token")` |
| `allowedChatIds` | 必须是非空 array。每个元素是 `Number.isSafeInteger(n)` 的 number，或匹配 `/^-?\d+$/` 且 `Number.isSafeInteger(Number(s))` 的 string。否则 `throw new Error("allowedChatIds")`。比较与 `sessionId` 都用 `String(number)`（string 先 `Number` 再 `String`），例如 `-100123`。 |
| `poll` | 仅当 `config.poll === true`（布尔）时为真。缺省、`"true"`、`1` 都是假。 |
| `workspaceRoot` | `poll === true` 时必须是 length > 0 的 string，否则 `throw new Error("workspaceRoot")`。`poll` 为假时忽略。 |
| `apiFetch` | 可选。测试注入。必须是 function，否则忽略，用全局 `fetch`。yml 不得依赖此字段。 |

yml 用户可写字段只有 `token` 与 `allowedChatIds`。`poll` / `workspaceRoot` 只来自 `createRuntime` overlay。yml 里写 `poll: false` **挡不住** startHost overlay（后写覆盖先写，与现有 `runtimeConfigById` 合并顺序一致：`{ ...(row.config ?? {}), ...(runtime[row.id] ?? {}) }`）。

yml 行 `id` **必须**是 `"channel-telegram"`，否则 overlay 打不中，host 不会 poll。测试与文档只用这个 id。

依赖：`@flintloom/kernel`、`@flintloom/channel`、`@flintloom/session`、`@flintloom/loop`。不新增第三方 npm 包。

根 `package.json` `devDependencies` 加 `@flintloom/channel-telegram` `workspace:*`。`pnpm-workspace.yaml` 已有 `packages/*`。只加 yml 不加根依赖 → 开机 `import` 失败。

### 5.4 适配器

与 webhook 对齐：

1. `sessions.getOrCreate(input.sessionId)`
2. `loop.runTurn({ ctx, session, text: input.text, workspaceRoot, channel: "telegram", signal })`。**不**传 `onEvent`。
3. 用返回的 `turnId` 调本包 `lastAssistantText`
4. 返回 `{ turnId, status, text }`。`status` 原样来自 `runTurn`。telegram 路径不得出现 `awaiting_action`（由 loop 的 `channel === "host"` 保证）。

`lastAssistantText` 与 `createTelegramAdapter` 只属于本包。**禁止**从 `@flintloom/channel-webhook` import。`packages/channel` 不得出现这两个名字。

算法与 webhook 相同：

```ts
export function lastAssistantText(events: readonly SessionEvent[], turnId: string): string {
  let start = -1;
  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;
    if (event.type === "turn/start" && event.turnId === turnId) {
      start = i;
    }
  }
  if (start < 0) {
    return "";
  }
  let text = "";
  for (let i = start + 1; i < events.length; i++) {
    const event = events[i]!;
    if (event.type === "turn/start") {
      break;
    }
    if (event.type === "assistant/message") {
      text = event.text;
    }
  }
  return text;
}
```

只认 `assistant/message`。忽略 chunk / `model/error` / `a2ui/*` / `tool/*`。

### 5.5 Poller 与 Bot HTTP

`startTelegramPoller` 返回 disposer：abort 一个 `AbortController`，循环退出。in-flight 的 `inbound` 使用**同一个** abort signal（或由它派生、dispose 时一并 abort 的 signal）。

启动后 **先** 清 webhook / 积压，再长轮询。循环（`signal.aborted` 则停）：

1. 若尚未成功 `deleteWebhook`：`POST` `https://api.telegram.org/bot<token>/deleteWebhook`  
   JSON body：`{ "drop_pending_updates": true }`。  
   `fetch` 传入 `{ method: "POST", headers: { "Content-Type": "application/json" }, body, signal }`。  
   - `signal.aborted`：退出。  
   - HTTP 非 2xx、JSON 无法解析、或 `ok !== true`：等待 **1000ms**（可 abort）后回到 1。固定短语 `deleteWebhook`，**不得**包含 token 或完整 URL。  
   - 成功：记下已清队列，进入步骤 2。此调用在本次 poller 生命周期内只成功一次。
2. `POST` `https://api.telegram.org/bot<token>/getUpdates`  
   JSON body：`{ "offset": <number>, "timeout": 30, "allowed_updates": ["message"] }`  
   `offset` 初始为 `0`（积压已在步骤 1 丢弃）。仅内存。  
   `fetch` 选项同步骤 1（含 `signal`）。
3. 若 `signal.aborted`：退出，不重试。
4. 若 HTTP 非 2xx、JSON 无法解析、或 `ok !== true`：等待 **1000ms**（可 abort）后回到 2。固定短语 `getUpdates`，**不得**包含 token 或完整 URL。catch 到的 `fetch` 异常 **不得** 原样再抛（URL 里有 token）。
5. `result` 必须是 array，否则按步骤 4 重试。若 **任一** 元素的 `update_id` 不是有限整数：按步骤 4 重试，本 batch **不** `busy.add`、**不** inbound（避免缺 id 时 offset 卡死又把已启动的 turn 重放）。
6. 对每个 update **按数组顺序同步**做完「ack + 是否启动 inbound」的判定（其间不得 `await`，以便同一 batch 里同 chat 第二条看到 busy）：
   - `offset = update_id + 1`（即使后面忽略该条）。
   - 若无 `message` 或 `message.chat.id` 不是 `Number.isSafeInteger` 的 number：停止该 update。
   - 将 `chat.id` 规范成 `String(chat.id)`。不在 `allowedChatIds` 规范集内：停止。
   - `message.text` 非 string 或 trim 后长度为 0：停止。
   - `sessionId = "telegram:" + chatId`。
   - `sessions.getOrCreate(sessionId)`。若 `turnBusy.has(sessionId)` 或本地 `sessionHasWaitingTurn(session)`：停止。
   - `turnBusy.add(sessionId)`。
   - **不要 await**：`void runInboundThenReply(...)`。
7. 全部 update 判定完后回到 2。

`runInboundThenReply`：

1. `try` `channels.inbound("telegram", { text: trimmed, sessionId, workspaceRoot, signal })`
2. 若 `signal.aborted`：不 `sendMessage`
3. 否则若返回 `text.length > 0`：`sendMessage`。`text.length > 4096` 则 `text.slice(0, 4096)`。
4. `catch`：吞掉；不重试 inbound。日志/抛出信息不得含 token。
5. `finally`：`turnBusy.delete(sessionId)`

`sessionHasWaitingTurn`：语义与 `apps/host/src/a2ui.ts` 现有函数相同（所有出现过的 `turn/start` id，任一 `session.isWaiting(turnId)` 为真）。实现放在 telegram 包内，**禁止** import `apps/host`。本片不把该函数搬到 `@flintloom/session`。

`sendMessage`：`POST` `https://api.telegram.org/bot<token>/sendMessage`，JSON `{ "chat_id": <message.chat.id 原样 number>, "text": <string> }`。不设 `parse_mode`。失败（非 2xx / `ok !== true`）不重试、不回滚 session。固定短语 `sendMessage`。catch 同样不得把带 token 的 URL 再抛出去。

`chat_id`：只使用 Telegram JSON 里的 number，不要改成 sessionId，不要改成字符串。

### 5.6 Loop

现有：

```ts
if (channel === "host" && stepWait) {
```

保持。增加一条测试：`channel: "telegram"` + wait 的 `a2ui_emit`（夹具与 webhook/cli 相同）→ **`status === "ok"`** 且有 `turn/end`。不要改写成 `channel !== "cli"`。

### 5.7 Host `createRuntime`

```ts
export type Runtime = { ctx: Context; stop: () => void };

export async function createRuntime(
  workspaceRoot: string,
  homeDir: string,
  opts?: { pollChannels?: boolean },
): Promise<Runtime>
```

`stop` 就是 `applyConfig` 的返回值。现网丢掉它；本片必须挂上。两参调用（CLI、现有测试）除新增空的 `turnBusy` 与 `stop` 外与现在相同。现有 `const { ctx } = await createRuntime(...)` 仍然合法。

当 `opts?.pollChannels === true` 时，在现有 `runtimeConfigById` 上增加：

```ts
runtimeConfigById["channel-telegram"] = {
  workspaceRoot,
  poll: true,
};
```

不要 overlay `token`。不要为缺省 ASSEMBLY 增加 telegram 行。

`startHost` **必须** `await createRuntime(opts.workspaceRoot, opts.homeDir, { pollChannels: true })`。

`close`：

1. `server.closeAllConnections()`（现有：掐掉 in-flight HTTP，含 hooks）
2. `runtime.stop()`（掐掉 telegram poll 与该次 inbound signal，并 dispose 全部插件 effect）
3. `server.close(...)`

`apps/cli/src/bin.ts` 保持两参 `createRuntime`，在 `process.exit` 前调用 `stop()`。

### 5.8 默认装配

**不加** telegram。去掉 telegram 行（默认状态）：host 启动、hooks 行为不变、没有 getUpdates。

测试夹具若要 poll，自己写 yml 三件套：`channel`、`channel-telegram`、合法 `token` + `allowedChatIds`。

## 6. 数据流

1. Boot：yml 按行 `apply`。`channel` provide 登记表；`channel-telegram` 校验配置并登记 `"telegram"`。仅 startHost overlay 后启动 poll。
2. 先 `deleteWebhook(drop_pending_updates)`，再 `getUpdates` → 过滤 → `inbound` → `runTurn({ channel: "telegram" })` → session 追加事件（写入 log 的 `user/message` 是 trim 后的文本）→ `sendMessage`。
3. 工作台可 `GET /v1/sessions/telegram:<chatId>` 重放完整 log。
4. 工作台 SSE 路径不变。CLI 仍 `channel: "cli"`，且不 poll。
5. Webhook `POST /v1/hooks` 不变。

## 7. 错误处理

| 情况 | 行为 |
|---|---|
| 缺/空 `token` | `apply` throw，message 含 `token`；已 apply 的插件回滚 |
| 缺/空/非法 `allowedChatIds` | throw，message 含 `allowedChatIds` |
| `poll === true` 但无 `workspaceRoot` | throw，message 含 `workspaceRoot` |
| yml 有 telegram 无 `channel` | throw，message 含 `channels` |
| 第二次 `register("telegram")` | throw，message 含 `telegram` |
| 白名单外 / 非文本 / trim 空 | ack，无 turn |
| 同 session busy 或 `awaiting_action` | ack，无 turn，无 sendMessage |
| 未配置 chat | turn `failed`；若有非空 `lastAssistantText` 仍 sendMessage，否则不发 |
| chat HTTP / 流错误 | 同上 |
| dispose / host close 时 inbound 进行中 | abort；不 sendMessage；busy finally 删除 |
| 进行中 telegram 打 `POST /v1/turns/:id/cancel` | **404** |
| `getUpdates` 失败 | 等 1s 再拉；不退出循环（除非 aborted） |
| `deleteWebhook` 失败 | 等 1s 再试；成功前不 getUpdates |
| `host.close` / `Runtime.stop` | abort poll 与 in-flight inbound；之后不得再发 Bot 请求 |
| `sendMessage` 失败 | 不重试；session 已有完整 turn |
| yml 无 telegram | 不登记、不轮询；host 其余功能不变 |

## 8. 安全

- Host 只绑 `127.0.0.1`。Bot token 不是 hostToken；持有 hostToken 不能代替 Telegram 白名单。
- 只有 `allowedChatIds` 能开 session。token 泄漏但攻击者不在名单内 → 消息被 ack 丢弃。
- token 永不进入 session 事件、JSON `text`、未脱敏日志、`Error.message`。
- 不把系统绝对路径发到 Telegram（回复只有模型文本）。
- 同一 session 不并行两个 turn（busy），避免 log 交错。工作台与 Telegram 抢同一 `telegram:<chatId>` 时 Telegram 静默丢消息。
- 入站只接受文本。不因本通道放宽工作区闸门。
- 测试不得请求 `api.telegram.org`。

## 9. 测试

不依赖真实 API key，不打真实 Telegram。假 `ChatProvider` 与 loop 现有测试相同。凡经 `startHost` 跑 `runTurn` 的用例：`registerChat` 之后必须 `setDefault("chat", 假 id)`。Bot 调用用注入 `apiFetch` 或测试内替换 `globalThis.fetch`。

1. **配置：** 缺 token / `token: ""` → apply 抛错且 message 含 `token`。`allowedChatIds` 缺省、`[]`、含 object → message 含 `allowedChatIds`。`poll: true` 无 workspaceRoot → 含 `workspaceRoot`。合法 token + `[123]` + 无 poll → 不 throw，且 `has("telegram")`。
2. **适配器 / `lastAssistantText`：** 假 `loop.runTurn` 断言 `channel === "telegram"`、传入的 `sessionId` / `text`、**没有** `onEvent`；返回的 `text` 为本 turn 最后一条 `assistant/message`。上一 turn 不得漏进。函数定义在 `packages/channel-telegram`，不在 `packages/channel`，不从 webhook 包 import。
3. **总 spec 验收（事件同构）：** 同一假 chat、**同一 `text` 字符串**、纯文本、无 A2UI wait。一次 `inbound("telegram")`，一次 `runTurn({ channel: "host" })`，两个 session。去掉每条事件里的 `turnId` 字段后，事件类型与其余 payload 序列相同。另测：入站 `"  hi  "` 写入的 `user/message` 为 `"hi"`。
4. **loop：** `channel: "telegram"` + wait 的 `a2ui_emit` → **`status === "ok"`** 且有 `turn/end`。现有 `host` 暂停与 `cli` / `webhook` 不暂停保持绿。
5. **poller（注入 fetch）：** 第一次 Bot 调用必须是 `deleteWebhook` 且 body 含 `drop_pending_updates: true`。在它成功返回之前不得出现 `getUpdates`。白名单外的 message → 有 getUpdates ack（后续 offset 含该 `update_id+1`），无 inbound、无 sendMessage。无 `text` 的 message 同上。`turnBusy` 已有该 sessionId → 无 inbound。手工 `append` 成 `awaiting_action` 后同上。合法文本 → inbound 一次，随后 sendMessage 的 body `chat_id` 为该 chat.id（number）、`text` 为适配器返回文本。返回 `text: ""` → 无 sendMessage。返回超长文本 → sendMessage 的 text 长度为 4096。`deleteWebhook` 一直失败 → 只有 deleteWebhook 重试，无 inbound。
6. **busy 共用：** 先把 `turnBusy.add("telegram:123")`，poller 收到该 chat 文本 → 不 inbound。host HTTP 测：`startHost` 后 `ctx.require("turnBusy")` 与 `/v1/hooks` 进行中（假 chat 挂起）是同一 Set（hooks 409 现有用例保持绿即可，另加：yml 含 telegram 时 startHost 仍提供该 Set）。
7. **CLI 不 poll：** yml 含合法 telegram；`createRuntime(ws, home)` 两参；mock fetch 在短等待内 **零次** 调用（或零次 URL 含 `getUpdates` / `deleteWebhook`）。`startHost` 同夹具：至少一次 `deleteWebhook`，随后允许 getUpdates（mock 立即返回 `{ ok: true, result: [] }`）。
8. **close 停 poll：** `startHost` + telegram yml + mock fetch；`await close()` 之后再等一拍，fetch 调用次数不再增加。
9. **host src：** 不含 `@flintloom/channel-telegram`、不含 `createTelegramAdapter`。允许 `@flintloom/channel` 类型 import。允许字符串 `"channel-telegram"` 作为 overlay 的 id。
10. **默认 yml：** 根 `flintloom.yml` 与 `ASSEMBLY` **不含** `channel-telegram`。根 `package.json` `devDependencies` 含包名（实现后）。
11. 现有 host / loop / CLI / DocForge / A2UI / 知识库 / webhook 测试保持绿。`const { ctx } = await createRuntime(...)` 现有写法保持能编译。

## 10. 与总 spec / 前切片的关系

总 spec §9「除桌面 host API 外入站走 `ctx.channels`」本片落地为：`getUpdates` 由 telegram 插件拥有；**turn 入站**走 `inbound("telegram")`。§7 密钥留在插件配置。§8 Telegram 不推 A2UI 树：本片只发文本。§14 同构口径与 webhook 9.3 相同（`channel` 字符串为 `"telegram"`）。

工作台仍是 [A2UI 设计](2026-08-17-flintloom-a2ui-design.md) 的 `channel: "host"` 暂停。Webhook 仍是 [webhook 通道设计](2026-08-20-flintloom-channel-webhook-design.md)。CLI 仍是 `channel: "cli"`。

`send` 登记表 API、附件、offset 落盘、`flint plugin add` 不在本片。每次 host 启动用 `deleteWebhook(drop_pending_updates)` 丢积压，不重放停机消息。

## 11. 实现顺序（本刀内）

1. `createRuntime` provide `turnBusy`，并把 `applyConfig` disposer 挂成 `Runtime.stop`；host HTTP 改用 `turnBusy`；`startHost.close` 调用 `stop`；现有 webhook / turns 409 测试保持绿。
2. `@flintloom/channel-telegram`：`parseTelegramConfig`、`lastAssistantText`、适配器、事件同构单测。
3. loop：`channel: "telegram"` 不暂停，断言 `status === "ok"`。
4. poller + 注入 fetch：`deleteWebhook` 先于 getUpdates、白名单、busy、sendMessage、空文本、截断。
5. `createRuntime` overlay `pollChannels`；`startHost` 三参；CLI 两参不 poll 但 `stop()`；close 后不再 fetch；host src 禁 import；根依赖。默认 yml **不加** 行。
