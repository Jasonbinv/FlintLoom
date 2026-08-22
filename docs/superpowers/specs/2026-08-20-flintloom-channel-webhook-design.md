# FlintLoom webhook 通道切片设计

日期：2026-08-20  
状态：待审阅（复核修订）  
产品：FlintLoom — A real agent. / 真正的 Agent。  
范围：总 spec 第四刀的 **webhook 第一片**。本机 host 增加回环 `POST /v1/hooks`，鉴权通过后把入站交给 `ctx.channels.inbound("webhook")`，由 `@flintloom/channel-webhook` 调同一套 `runTurn`。禁止再往 `createRuntime` 里 `register`。HTTP 路由仍由 host 拥有，不把 listen 做成插件。

## 1. 这是什么

外部调用方（curl、本机自动化）对已启动的 Flint host 发一句文本，等到这一轮 turn 结束，拿到 JSON 快照。session log 与工作台 turn 使用同一套 `runTurn` 事件。HTTP 本身不是 SSE：调用方要的是一次请求的最终文本。

验收：yml 挂上 channel 插件后，带 hostToken 的 `POST /v1/hooks` `{ "text": "…" }` 返回 JSON，键顺序为 `turnId`、`status`、`text`；`GET /v1/sessions/webhook` 能重放该 turn 的 session 事件。假 `ChatProvider`、**同一 `text` 字符串**、无 A2UI wait 时，`inbound` 写出的事件与 `runTurn({ channel: "host" })` 同构（见 9.3）。yml 去掉 `channel-webhook` 后该路由 404。自动化测试不依赖真实 API key。

同构 **不是**「同一 HTTP body 分别打 `/v1/hooks` 与 `/v1/turns`」。hooks 会 trim；`/v1/turns` 不 trim，空串也可以开 turn。

## 2. 复核后收紧的决策

| 点 | 决定 |
|---|---|
| HTTP 落点 | host 已有 `127.0.0.1:7331`。路径 **`POST /v1/hooks`**。插件不 `listen`。 |
| 鉴权 | 与其它 `/v1/*` 相同：`Authorization: Bearer <hostToken>`。本片 **不** 另做 webhook secret。token 不进 session log、不进 JSON `text`。持有 token 等于本机控制权：可以指定**任意** `sessionId`，包括工作台正在用的那个。这是有意的。 |
| 启停 | `flintloom.yml` 必须有 `@flintloom/channel-webhook` 行（且能 `apply` 成功）才登记适配器。没有 `channels` 或未登记 `"webhook"` → 已鉴权的 POST 也 **404**。 |
| 请求体 | `{ text, sessionId? }`。不要附件、不要 multipart、不要工作区路径列表。 |
| `sessionId` | 可选。缺省或 trim 后为空 → 字面量 `"webhook"`。非 string → 400。 |
| `text` | 必填 string；trim 后长度为 0 → 400。入站使用 **trim 后** 的 `text` 与 `sessionId`。 |
| 响应 | 等到 `runTurn` 返回。HTTP **200** + JSON。`failed` / `cancelled` 也是 200，用 `status` 区分，避免调用方按 5xx 重试导致同一句话跑两遍。 |
| JSON `text` | 本 turn 最后一条 `assistant/message` 的 `text`；没有则为 `""`。不拼接 chunk，不把 `model/error` 写入该字段。算法在 `@flintloom/channel-webhook`，不进登记表包。 |
| A2UI | `channel === "webhook"` 时 **不** 因 `a2ui_emit` wait 暂停（与 `cli` 相同）。不向调用方推送 A2UI 树。loop 判断保持 `channel === "host"` 才暂停，不要改成「非 host 都不暂停」的大重构。 |
| 冲突 | 同一 `sessionId` 已有 **任意** in-flight HTTP（`POST /v1/turns`、`POST /v1/turns/:id/actions`、`POST /v1/hooks`），或该 session 正 `awaiting_action` → **409**。三路共用一把 per-session busy。这是对现网 `/v1/turns` 的收紧：以前只有 wait 才 409，进行中的 SSE 可以并行；本片之后同一 session 第二次 POST 一律 409。 |
| 取消 | 本片 **不** 把 webhook turn 写入 `controllers` / `turns`。进行中的 webhook：`POST /v1/turns/:id/cancel` → **404**。取消只靠断开 `POST /v1/hooks`。不要为了 cancel 给适配器加 `onEvent`。 |
| 超时 | **不加** HTTP / turn deadline。与桌面 SSE 相同，等 `runTurn` 结束或断开。 |
| 出站 | 本片 **不** 实现 `send` / `deliver`。`packages/channel` 只做登记表 + `inbound`。 |
| 工作台 / CLI | `POST /v1/turns` 与 `flint` 入站本片不迁到 `ctx.channels`。 |

## 3. 非目标

- Telegram、ACP、Slack / Discord / 邮件 / 飞书
- `packages/channel-desktop`、`packages/channel-cli`、`packages/channel-telegram`
- `ctx.channels.send` / `deliver` 出站
- 附件、multipart、把文件写入工作区
- 独立 webhook secret、SSE、`202` + 轮询
- 给 webhook 接 `POST /v1/turns/:id/cancel`
- `flint plugin add`
- 改桌面 UI、改 A2UI catalog、改 DocForge 工具
- 把 HTTP 路由登记进插件 `apply`
- 引入 dataagent-v3 / deepseek-harness / Cordis

## 4. 架构

```text
flintloom.yml
  … loop
  - id: channel
    name: "@flintloom/channel"
  - id: channel-webhook
    name: "@flintloom/channel-webhook"

host listen 127.0.0.1
  POST /v1/hooks
    Bearer hostToken
    drain body
    JSON { text, sessionId? }
        │
        ├─ 无适配器 → 404
        ├─ 坏 body → 400
        └─ busy / awaiting_action → 409
        │
        ▼
ctx.get("channels").inbound("webhook", { text, sessionId, workspaceRoot, signal })
        │
        ▼
webhook 适配器
  sessions.getOrCreate(sessionId)
  loop.runTurn({ channel: "webhook", … })
  lastAssistantText（本包）
        │
        ▼
200 { turnId, status, text }
session log 仍是完整 runTurn 事件
```

Flint（host）拥有：bind、hostToken、JSON 解析、busy、写 HTTP 响应。  
Loom 拥有：`channels` 登记表、webhook 适配器、`runTurn`、session log。

host **禁止**为 webhook 调用 `runTurn`。host **禁止** import `@flintloom/channel-webhook`。允许从 `@flintloom/channel` **只导入类型**（`ChannelRegistry` 等）。

## 5. 组件

### 5.1 `@flintloom/channel`

服务键：`"channels"`。

```ts
export type ChannelInbound = {
  text: string;
  sessionId: string;
  workspaceRoot: string;
  signal: AbortSignal;
};

export type ChannelInboundResult = {
  turnId: string;
  status: "ok" | "failed" | "cancelled" | "awaiting_action";
  text: string;
};

export type ChannelAdapter = {
  inbound(input: ChannelInbound): Promise<ChannelInboundResult>;
};

export type ChannelRegistry = {
  has(id: string): boolean;
  register(id: string, adapter: ChannelAdapter): () => void;
  inbound(id: string, input: ChannelInbound): Promise<ChannelInboundResult>;
};
```

- `apply`：`ctx.provide("channels", registry)`。
- `register` 的 disposer 必须由调用方 `ctx.effect`；`stop()` 后 `has(id) === false`。
- **同一 `id` 已登记再 `register` → throw**，`Error.message` **含该 id**。不要静默覆盖。
- `inbound`：未知 `id` → throw，`Error.message` **含该 id**。host 在调用前先 `has("webhook")`，生产路径不会打到未知 id。
- 本片没有 `send`。禁止先留空方法再抛 `not implemented` 给 host 调用。

yml 行必须在 `channel-webhook` **之前**。`channel-webhook` 的 `apply` 开头 `ctx.require("channels")`。

### 5.2 `@flintloom/channel-webhook`

```ts
{
  name: "@flintloom/channel-webhook",
  apply(ctx) {
    const channels = ctx.require<ChannelRegistry>("channels");
    ctx.require("sessions");
    ctx.require("loop");
    ctx.effect(channels.register("webhook", createWebhookAdapter(ctx)));
  },
}
```

适配器：

1. `sessions.getOrCreate(input.sessionId)`
2. `loop.runTurn({ ctx, session, text: input.text, workspaceRoot, channel: "webhook", signal })`。**不**传 `onEvent`。
3. 用返回的 `turnId` 调本包 `lastAssistantText`（见 5.4）
4. 返回 `{ turnId, status, text }`。`status` 原样来自 `runTurn`。webhook 路径不得出现 `awaiting_action`（由 loop 的 `channel === "host"` 保证）。

本片插件 `config` 为空即可。不要读第二份 secret。

依赖：`@flintloom/kernel`、`@flintloom/channel`、`@flintloom/session`、`@flintloom/loop`（类型 / `require`）。不新增第三方 npm 包。

`lastAssistantText` 与 `createWebhookAdapter` 只属于本包。`packages/channel` 不得出现这两个名字。

### 5.3 Host 路由

在现有 `/v1/*` Bearer 检查 **之后**处理 `POST` + pathname 全等 `"/v1/hooks"`。

其它方法打到 `/v1/hooks`：不要单独 405，落到现有未知路由 **404**（不读 body）。

`startHost` 持有 `busy: Set<string>`（sessionId）。三处 HTTP 必须使用它：

| 路由 | 何时 `busy.add(sessionId)` | 何时 `delete` |
|---|---|---|
| `POST /v1/hooks` | 409 检查通过之后、调用 `inbound` 之前 | **try/finally**，含 inbound 抛错导致的 500 |
| `POST /v1/turns` | `sessionHasWaitingTurn` / 已 busy 的 409 之后、`streamLoopResult` 之前 | **try/finally**，含 SSE 抛错。`awaiting_action` 返回后 HTTP 已结束，仍要 delete；之后靠 `sessionHasWaitingTurn` |
| `POST /v1/turns/:id/actions` | 现有 409 检查通过之后、`continueTurn` 的 `streamLoopResult` 之前 | **try/finally**。必须覆盖：`continueTurn` 一开始就会 `append(a2ui/action)`，此后 `isWaiting` 为 false，若漏 busy，webhook 会插进同一 session |

`busy.add` 与检查之间不得 `await`（单线程下检查+加入视为原子）。`sessionId` 用 `session.id`。

`POST /v1/hooks` 处理顺序：

1. **`await readBody(req)`**。只要方法与路径匹配，无论后面 404/400/409，都先 drain。不要把未读 POST 留在套接字上。
2. `channels = ctx.get("channels")`；`channels === undefined` 或 `!channels.has("webhook")` → **404**，空 body。
3. `JSON.parse` 已读字符串。失败、非对象、`text` 缺或非 string、`sessionId` 出现但非 string → **400**，空 body。不写 session。
4. `text = text.trim()`；长度为 0 → **400**。
5. `sessionId`：缺省或 trim 后长度为 0 → `"webhook"`；否则用 trim 后的值。其它 JSON 键忽略。
6. `sessions.getOrCreate(sessionId)`。若 `sessionHasWaitingTurn(session)` 或 `busy.has(sessionId)` → **409**，空 body。
7. `busy.add(sessionId)`。`AbortController`：客户端断开（`req` 的 `close` / `aborted`）则 abort。成功写完响应后 `off`，避免 `res.end` 触发的 `close` 误伤下一轮。
8. `try { result = await channels.inbound("webhook", { text, sessionId, workspaceRoot, signal }) } finally { busy.delete(sessionId) }`。
9. inbound 抛错 → 外层现有 500 + `formatHostError`（busy 已在 finally 清掉）。
10. **200**，用现有 `sendJson`（`Content-Type: application/json`，不要另加 charset 或其它 header）。

```ts
JSON.stringify({
  turnId: result.turnId,
  status: result.status,
  text: result.text,
})
```

键顺序固定为 `turnId`、`status`、`text`。不要多加 `sessionId`、`events`、`error` 字段。

`startHost` 的返回值 **增加** `runtime`（现有 `url` / `close` 不变）。`apps/host/src/listen.ts` 不使用它。测试用它在 POST 前 `registerChat` **并且** `setDefault("chat", 假 id)`，避免进程环境里已有 `FLINTLOOM_API_KEY` 时 `models-chat` 仍是 default、用例打到真网。

`apps/host/src` 不得出现：`@flintloom/channel-webhook`、`createWebhookAdapter`、`lastAssistantText`。不要用正则禁止单词 `hooks` 或 `channel`（路由字符串会合法出现）。

### 5.4 本 turn 的助手文本

实现于 `@flintloom/channel-webhook`（可 named export 给单测）。**不要**放到 `@flintloom/channel`。

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

只认 `assistant/message`。忽略 `assistant/chunk`、`model/error`、`a2ui/*`、`tool/*`。按本 `turnId` 的 `turn/start` 切片，不会误用上一轮回复。

### 5.5 Loop

现有：

```ts
if (channel === "host" && stepWait) {
```

保持。增加一条测试：`channel: "webhook"` + wait 的 `a2ui_emit`（夹具与现有 cli 用例相同：第一步 emit，第二步文本）→ **`status === "ok"`** 且有 `turn/end`。不要写成「非 `awaiting_action`」。不要把条件改写成 `channel !== "cli"`。

### 5.6 默认装配

仓库根 `flintloom.yml` 与 host 测试 `ASSEMBLY` 在 `loop` 之后追加：

```yaml
  - id: channel
    name: "@flintloom/channel"
  - id: channel-webhook
    name: "@flintloom/channel-webhook"
```

`id` 必须是这两字面量（yml 行 `id` 不是服务键；服务键是 `"channels"`）。去掉任一行：缺 `channel` 则 `channel-webhook` 的 `require("channels")` 拒绝启动；只去掉 `channel-webhook` 则 host 启动但 hooks 404。

`applyConfig` 在 `@flintloom/kernel` 里 `import(包名)`，解析走到仓库根 `node_modules`。必须把 `@flintloom/channel` 与 `@flintloom/channel-webhook` 写入根 `package.json` 的 `devDependencies`（`workspace:*`），与 `fs` / `a2ui` 相同。只加 yml 不加根依赖 → 开机 `import` 失败。`pnpm-workspace.yaml` 已有 `packages/*`，新目录会自动纳入；仍要 `pnpm install` 更新 lockfile。

## 6. 数据流

1. Boot：yml 按行 `apply`。`channel` provide 登记表；`channel-webhook` 登记 `"webhook"`。
2. `POST /v1/hooks` → hostToken → drain → 适配器 `runTurn` → session 追加事件（与桌面同一套 loop，仅 `channel` 字符串为 `"webhook"`；写入 log 的 `user/message` 是 trim 后的文本）。
3. HTTP 返回 JSON 快照。调用方可再 `GET /v1/sessions/:id` 重放完整 log。
4. 工作台 SSE 路径不变。CLI 仍 `channel: "cli"`。

## 7. 错误处理

| 情况 | 行为 |
|---|---|
| 无 Bearer / token 错 | **401**，空 body。yml 有没有 webhook 都一样。401 在 drain 之前（与所有 `/v1/*` 相同） |
| 已鉴权，无适配器 | 先 drain，再 **404**，空 body |
| 非法 JSON / 字段类型错 / trim 后 `text` 为空 | **400**，不写 session |
| 同 session in-flight（含 turns / actions / hooks）或 `awaiting_action` | **409** |
| 未配置 chat | turn `failed`，log 有 `model/error`；HTTP **200** `{ "status": "failed", "text": "" }`（若本 turn 无 `assistant/message`） |
| chat HTTP / 流错误 | 同上，**200** + `failed` |
| 客户端断开 `POST /v1/hooks` | abort；若响应尚未写出则 **200** `{ "status": "cancelled", "text": "<算法结果>" }` |
| 进行中 webhook 打 `POST /v1/turns/:id/cancel` | **404**（未写入 `controllers` / `turns`） |
| `inbound` / `runTurn` 抛未捕获异常 | **500** + `formatHostError`（剥密钥）；busy 已 finally 删除 |
| 工具失败 | 现有 loop：结果回给模型，turn 继续 |
| yml 无 `channel-webhook` | 路由 404；其它插件工具 schema 不变 |
| yml 有 `channel-webhook` 无 `channel` | 进程拒绝启动，错误含 `channels` |
| 第二次 `register("webhook")` | 拒绝启动或该次 `register` 抛错，错误含 `webhook` |

400 / 401 / 404 / 409 均空 body，与现网 `send(res, code)` 一致。

## 8. 安全

- 只绑现有 host `127.0.0.1`。必须 hostToken。
- hostToken 与任何未来插件 secret 永不进入 session 事件、JSON `text`、或未脱敏的 500 正文。
- 持有 hostToken 可以写入任意 `sessionId`（含工作台会话）。不另做隔离。
- 入站只接受文本。不因 webhook 放宽工作区闸门。
- 不把系统绝对路径写进 JSON。
- 同一 session 不并行跑两个 turn（409），避免 log 交错。

## 9. 测试

不依赖真实 API key。假 `ChatProvider` 与 loop 现有测试相同。凡经 `startHost` 跑 `runTurn` 的用例：`registerChat` 之后必须 `setDefault("chat", 假 id)`。

1. **channel 登记表：** `register("webhook", …)` 后 `has` 为 true；`inbound` 调到适配器；未知 id 的 `inbound` 抛错且 message 含该 id；**同一 id 再 register 抛错且 message 含该 id**；插件 `stop()` 后 `has` 为 false。
2. **webhook 适配器 / `lastAssistantText`：** 假 `loop.runTurn` 断言 `channel === "webhook"`、传入的 `sessionId` / `text`、**没有** `onEvent`；返回的 `text` 为本 turn 最后一条 `assistant/message`。上一 turn 的 `assistant/message` 不得漏进本 turn。函数定义在 `packages/channel-webhook`，不在 `packages/channel`。
3. **总 spec 验收（事件同构）：** 同一假 chat、**同一 `text` 字符串**、纯文本、无 A2UI wait。一次 `inbound`，一次 `runTurn({ channel: "host" })`，两个 session。去掉每条事件里的 `turnId` 字段后，事件类型与其余 payload 序列相同。不要用「hooks HTTP body vs turns HTTP body」当同构夹具。另测：hooks `{ "text": "  hi  " }` 写入的 `user/message` 为 `"hi"`。
4. **loop：** `channel: "webhook"` + wait 的 `a2ui_emit` → **`status === "ok"`** 且有 `turn/end`。现有 `host` 暂停用例与 `cli` 不暂停用例保持绿。
5. **host HTTP：** 省略 `channel-webhook` → 无 token **401**，有 token 且 POST 带 body → **404**（证明 drain 后仍 404）。装配齐全：无 token **401**；`{}` / 无 `text` / `"  "` → **400**；假 chat + `setDefault` + `{ "text": "hi" }` → **200**，JSON 键顺序 `turnId`、`status`、`text`，`status === "ok"`；默认 session 为 `webhook`。传 `sessionId` 则写到该 id。同 session 第二条 hooks **409**。`/v1/turns` 进行中（假 chat 挂起）再 hooks 同一 `sessionId` → **409**。`awaiting_action` 期间 hooks → **409**。假 chat 挂起时对该 `turnId` 调 cancel → **404**；断开 hooks 请求 → 该 turn `cancelled`。
6. **host src：** 不含 `@flintloom/channel-webhook`、不含 `createWebhookAdapter`、不含 `lastAssistantText`。允许 `@flintloom/channel` 类型 import。
7. **yml / 根依赖：** 默认 `ASSEMBLY` 与仓库根 `flintloom.yml` 含这两行。根 `package.json` `devDependencies` 含两个包名。去掉 webhook 行后 schema 仍有 `fs` 等，只是 hooks 404。
8. 现有 host / loop / CLI / DocForge / A2UI / 知识库测试保持绿。

## 10. 与总 spec / 前切片的关系

总 spec §7 本片增加 `POST /v1/hooks`。§9「除桌面 host API 外入站走 `ctx.channels`」落地为：listen/token 仍是 host；**turn 入站**走 `inbound("webhook")`。§14「webhook POST 产生与桌面 turn 相同的 session 事件」落地为第 9.3 节：**同一 `text`、无 wait** 的 `runTurn` 事件同构，外加第 9.5 节 HTTP。不是 HTTP 契约与 `/v1/turns` 逐字段相同。

工作台仍是 [A2UI 设计](2026-08-17-flintloom-a2ui-design.md) 的 `channel: "host"` 暂停。CLI 仍是插件组装刀的 `channel: "cli"`。

Telegram、`send`、附件、webhook 的 cancel 登记、`flint plugin add` 不在本片。

## 11. 实现顺序（本刀内）

1. `@flintloom/channel` 登记表 + 重复 id / 未知 id 单测。
2. `@flintloom/channel-webhook`：`lastAssistantText`、适配器、事件同构单测。
3. loop：`channel: "webhook"` 不暂停，断言 `status === "ok"`。
4. host：drain、`POST /v1/hooks`、busy 覆盖 turns / actions / hooks、`startHost` 返回 `runtime`。
5. 默认 yml / `ASSEMBLY` / 根 `package.json`；省略插件 404；第 9 节验收全绿。
