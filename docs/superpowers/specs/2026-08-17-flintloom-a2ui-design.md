# FlintLoom A2UI（交互核心）设计

日期：2026-08-17  
状态：待审阅  
产品：FlintLoom — A real agent. / 真正的 Agent。  
范围：总 spec 第三刀的 **A2UI 块**。插件 `@flintloom/a2ui`、工具 `a2ui_emit`、session 事件 `a2ui/surface` / `a2ui/action`、`POST /v1/turns/:id/actions`、工作台内联 4+2 组件 host。从出生就是插件：禁止再往 `createRuntime` 里 `register`。

## 1. 这是什么

Agent 通过 `a2ui_emit` 发出符合 A2UI **v0.9 信封**的 JSON（`createSurface` / `updateComponents` / `updateDataModel` / `deleteSurface`）。Host 校验后写入 session，经现有 SSE 推到工作台，在聊天列内联渲染。用户点按钮或提交选择后，`POST /v1/turns/:id/actions` 写入 `a2ui/action` 并 **用同一 `turnId` 新开一轮 SSE** 继续模型，不是新 turn，也不是把原来的 `/v1/turns` 流一直挂着。

本片组件冻成：**Column、Row**（布局）+ **Text、Markdown、Button、ChoicePicker**（总 spec 的 text / markdown / button / choice）。未知组件整次 emit 失败。不拉远程 catalog，不用官方 `@a2ui/react`，不搬 dataagent 渲染器。

验收：`pnpm desktop` 里模型发出带 Button 的 surface → 聊天里出现卡片 →「发送」禁用 → 点击后同一 turn 继续并收到模型回复；点「取消」则该 turn `cancelled`。`channel === "cli"` 时 emit 成功但不暂停，`flint` 仍能跑完一轮。自动化测试不依赖真实 API key。

## 2. 复核后收紧的决策

| 点 | 决定 |
|---|---|
| 切法 | 独立 `@flintloom/a2ui`。校验 + `a2ui_emit`。工作台自写 React host。 |
| 信封 | 公开 A2UI v0.9：每条 message 含 `"version": "v0.9"` 且 **恰好一个** 主键。 |
| catalog | 本仓冻结合约，`catalogId` 只接受 `flintloom:a2ui:core`。不 fetch URL。 |
| 布局 | 必须有 Column / Row，否则标题+双按钮无法组树。根组件 `id` 必须为 `"root"`。 |
| Markdown | 独立组件；**不跑 HTML**。按预格式文本显示（保留换行），无链接抓取。 |
| 暂停 | 仅 `channel === "host"`（工作台）。`cli` / `test` 不暂停。 |
| 何时 wait | 本步成功 emit 的组件树里存在 Button 或 ChoicePicker。纯 Text/Markdown 不暂停。 |
| 续跑 | 同一 `turnId`，新 SSE。不写第二次 `turn/start`。 |
| 等待时输入 | 禁用「发送」；可点卡片或「取消」。 |
| 选择 | ChoicePicker 只改本地 data model；**Button 点击才 POST**。若有 ChoicePicker 但无 Button，选一项即 POST（否则发送已禁用会卡死）。 |
| 投影 | `a2ui/surface` **不**进 `deriveMessages`（已有 `tool/call` + `tool/result`）。`a2ui/action` 进一条 `user` 消息。 |
| loop | 增加 `continueTurn`；`runTurn` 在 host 且 wait 时返回 `awaiting_action`，**不**写 `turn/end`。loop 可 `ctx.get("a2ui")`。 |
| host | 用结构类型 `ctx.get("a2ui")`。`apps/host/src` 不得出现 `@flintloom/a2ui`、`createA2uiEmitTool`（连 `import type` 也不要）。 |
| 通道名 | 工作台 HTTP 现有 `channel: "host"`，不要改成 `"desktop"`。 |

## 3. 非目标

- data table、chart、infographic、Card、List、Image、Icon、Video、Modal、官方 `@a2ui/react`
- 运行时下载 catalog；远程 URL 图/图标
- `tools/post-execute`、`agent/pre-step`
- `flint plugin add`、MCP、skill、通道、其余 DocForge 工具
- 把 HTTP 路由做成插件
- 引入 dataagent-v3 / deepseek-harness / Cordis
- 改知识库语义；改 Files 预览

## 4. 架构

```text
flintloom.yml  … → docforge → a2ui → loop

@flintloom/a2ui
  provide("a2ui")     validate emit / action；判断 wait
  register a2ui_emit

@flintloom/loop
  runTurn        一步工具后若 a2ui.wait && channel==="host"
                 → 返回 awaiting_action，不写 turn/end
  continueTurn   追加 a2ui/action，同一 turnId 再跑 step

apps/host
  SSE 转发 a2ui/surface；stream 结束帧 { type:"end", status }
  POST /v1/turns/:id/actions
  禁止 import @flintloom/a2ui

apps/desktop
  聊天列内联渲染；awaiting_action 时禁用发送、显示取消
```

yml 在 `docforge` 与 `loop` 之间插入：

```yaml
  - id: a2ui
    name: "@flintloom/a2ui"
```

`@flintloom/a2ui` 的 `apply` **必须** `require("tools")`。yml 去掉 a2ui → 启动成功；无 `a2ui_emit`；`POST /actions` **404**。loop **不** `require("a2ui")`；缺插件时行为与今日相同。

根 `package.json` 把 `@flintloom/a2ui` 列为 `devDependencies`（与 knowledge 相同，供 `import(name)` 从仓库根解析）。

无 `dbPath` / API key overlay。`createRuntime` 不为 a2ui 写 `runtimeConfigById`。

## 5. 组件

### 5.1 `ctx.a2ui`

```ts
type A2uiMessage =
  | { version: "v0.9"; createSurface: { surfaceId: string; catalogId: string; theme?: unknown; sendDataModel?: boolean } }
  | { version: "v0.9"; updateComponents: { surfaceId: string; components: A2uiComponent[] } }
  | { version: "v0.9"; updateDataModel: { surfaceId: string; path?: string; value?: unknown } }
  | { version: "v0.9"; deleteSurface: { surfaceId: string } };

type A2uiComponent = {
  id: string;
  component: "Column" | "Row" | "Text" | "Markdown" | "Button" | "ChoicePicker";
  [key: string]: unknown;
};

type A2uiEmitResult = {
  status: "ok";
  surfaceId: string;
  wait: boolean;
};

type A2uiAction = {
  surfaceId: string;
  name: string;
  context?: unknown;
  data?: unknown;
};

type A2uiService = {
  /** 校验 messages；成功则记下快照并返回 wait（是否含 Button / ChoicePicker）。 */
  validateEmit(messages: unknown): { surfaceId: string; wait: boolean; messages: A2uiMessage[] };
  /** loop 写 `a2ui/surface` 时取走最近一次成功 validate 的快照（含 messages）。 */
  takeLastEmit(): { surfaceId: string; wait: boolean; messages: A2uiMessage[] } | undefined;
  /** surface 仍在、name 非空：须等于该树某个 Button 的 `action.event.name`，或无 Button 时为 `"choice"`。 */
  validateAction(action: A2uiAction): void;
};
```

`validateEmit` 规则（命中即失败，工具返回 `failed: …`，**不写** `a2ui/surface`）：

1. `messages` 不是长度 1–8 的数组。
2. JSON 序列化后大于 **64KiB**。
3. 任一条不是 v0.9 单主键信封。
4. `createSurface.catalogId !== "flintloom:a2ui:core"`。
5. 组件 `component` 不在冻结目录；或缺 `id`。
6. 应用全部 `updateComponents` 之后，不存在 `id === "root"`。
7. `children` / `child` 引用了未定义的 id。
8. 出现 **Image / Icon / Video** 或任何带 `http://` `https://` 的字符串属性（防远程资源）。`path` 绑定除外。

`deleteSurface` 可出现在同一次数组末尾；若删除后无剩余交互组件，`wait=false`。

一次 `a2ui_emit` **只服务一个 `surfaceId`**（所有 message 的 surfaceId 必须相同）。同一步多次 emit：各自写 surface 事件；**最后一次** `wait===true` 决定是否暂停。

### 5.2 冻结目录（v0.9 扁平组件）

属性名跟 A2UI v0.9 基本目录对齐，只实现子集。

| component | 必填 | 其它 |
|---|---|---|
| `Column` / `Row` | `children`: string[]（组件 id） | `justify` / `align` 可忽略或原样存，host 用简单 flex |
| `Text` | `text`: string 或 `{ path: string }` | `variant`: `h1`…`h5` / `caption` / `body`（缺省 `body`） |
| `Markdown` | `text`: string 或 `{ path }` | 不解析 HTML；换行保留 |
| `Button` | `child`: 标签组件 id；`action.event.name`: 非空字符串 | `variant`: `primary` / `borderless` |
| `ChoicePicker` | `options`: `{ label: string, value: string }[]`（1–20） | `value`: string 或 `{ path }`；本片 **单选** |

`{ path }` 只允许 `/` 开头、分段为 `[A-Za-z0-9_]+` 的 JSON 指针子集，指向该 surface 的 data model。非法 path → emit 失败。

### 5.3 `a2ui_emit`

参数 `{ messages: unknown }`。

| 情况 | 返回 |
|---|---|
| `signal.aborted` | `aborted` |
| 校验失败 | `failed: <reason>`（短英文，如 `unknown component`、`missing root`、`bad catalog`、`too large`） |
| 成功 | `JSON.stringify({ status:"ok", surfaceId, wait })` |

成功时 **loop** 在 `tool/result` 之后追加：

```ts
{ type: "a2ui/surface"; turnId: string; surfaceId: string; messages: A2uiMessage[]; wait: boolean }
```

工具本身只返回字符串（与现有工具相同）。loop 在 `ctx.get("a2ui")` 存在且 `call.name === "a2ui_emit"` 且 result 以 `{` 开头并能 `JSON.parse` 出 `status==="ok"` 时，用刚才 `validateEmit` 的结果写 surface 事件（validate 在 tool 内已做过；loop 再 parse result 的 `wait` / `surfaceId` 即可，**不必重放 messages 校验**）。`messages` 进 session 的来源：tool 成功路径把 messages 放进 result 会撑爆 prompt。因此：

- **tool result JSON 只有** `{ status, surfaceId, wait }`（无 messages、无全文树）。
- **surface 树只存在** `a2ui/surface` 事件里，供 UI 重放。
- 模型下一 step 看见的是 tool result 短 JSON，不是组件树全文。

loop 写 `a2ui/surface` 时需要 messages：从 `ctx.get("a2ui")` 取 **上一次成功 validate 的快照**（`A2uiService.takeLastEmit(): { surfaceId, wait, messages } | undefined`，读后不清也可；同一步多次 emit 每次覆盖/追加按 surfaceId）。推荐 `takeLastEmit()` 在 loop 写完事件后由 service 保留 map，供 `validateAction` 对照。

### 5.4 Session 与投影

`SessionEvent` 增加：

```ts
| { type: "a2ui/surface"; turnId: string; surfaceId: string; messages: A2uiMessage[]; wait: boolean }
| { type: "a2ui/action"; turnId: string; surfaceId: string; name: string; context?: unknown; data?: unknown }
```

`deriveMessages`：

- 忽略 `a2ui/surface`（与 `assistant/chunk` 一样只留 log）。
- `a2ui/action` → `flushCalls()` 后 `{ role: "user", content: JSON.stringify({ type: "a2ui/action", surfaceId, name, context, data }) }`。

`RunTurnResult.status` 增加 `"awaiting_action"`。  
SSE 结束帧仍是 `{ type: "end", status }`，status 含 `awaiting_action`。该帧 **不是** session 事件。

等待中：**没有** `turn/end`。重放判定：最近一次 `turn/start` 之后没有 `turn/end`，且其后最后一条 `a2ui/surface` 的 `wait===true`，且没有更新的 `a2ui/action` → 仍在等待。按钮仅该 `surfaceId` 可点；更早已结束 turn 里的 surface **只展示**。

### 5.5 Loop

`runTurn`：现有 step 循环。每步工具全部执行完后：

- 若 `channel === "host"` 且本步至少一次 `a2ui_emit` 成功且 `wait===true` → `return { turnId, status: "awaiting_action" }`（不 `assistant/message`，不 `turn/end`）。
- 否则与今日相同（无 tool call 则 `assistant/message` + `turn/end` ok）。

`continueTurn`：

```ts
continueTurn(input: {
  ctx: Context;
  session: Session;
  turnId: string;
  action: A2uiAction;
  workspaceRoot: string;
  channel: string;
  signal: AbortSignal;
  onEvent?: (event: SessionEvent) => void;
}): Promise<RunTurnResult>;
```

前置：该 `turnId` 必须是 session 里最后一次 `turn/start` 的 id，且处于上一节的等待态。否则抛错，host 映射 409。通过则 `validateAction` → append `a2ui/action` → **从 step 循环开头继续**（不再 append `turn/start` / `user/message`）。后续仍可再次 `awaiting_action`。

`LoopService` 同时提供 `runTurn` 与 `continueTurn`。

### 5.6 Host HTTP

`POST /v1/turns/:id/actions`，Bearer 同其它路由。body：

```json
{ "surfaceId": "main", "name": "submit_form", "context": {}, "data": {} }
```

| 情况 | HTTP |
|---|---|
| 无 Bearer | 401 |
| 无 a2ui 插件 | 404 |
| 非法 JSON / 缺 surfaceId 或 name | 400 |
| turn 不存在或非等待态 | 409 |
| `validateAction` 失败 | 400 |
| 成功 | **200 SSE**（与 `/v1/turns` 相同：转发 session 事件，最后 `{ type:"end", status }`） |

**关闭第一轮 SSE 不得取消 turn。** 今日 `req.on("close") → abort` 在 `res.end()` 后会误伤 `awaiting_action`。必须在写入 `end/awaiting_action` 之前卸掉该 close 监听，或仅当 status 不是 `awaiting_action` 时 abort。`turnId` 留在 `controllers` 里供 `POST /cancel`；`awaiting_action` 时 cancel = 写 `turn/end cancelled` 并清等待态（无在途 LLM 也可）。`continueTurn` 使用 **新的** AbortController，绑到 **新的** SSE `req.close`。

`GET /v1/sessions/:id` 原样返回含 `a2ui/*` 的 events。

`POST /v1/turns` 的 `end` status 原样带上 `awaiting_action`。

factory 扫描仍覆盖整个 `apps/host/src`，并禁止 `@flintloom/a2ui`、`createA2uiEmitTool`。

### 5.7 Desktop

- 聊天列遇到 `a2ui/surface` 渲染内联卡片（flex：Column=纵、Row=横）。
- `end.status === "awaiting_action"`：`sending=false`，发送按钮 **disabled**，显示「取消」（走现有 `/v1/turns/:id/cancel`）。
- Button：`POST /v1/turns/:id/actions`，`name` 来自 `action.event.name`；`data` 为该 surface 当前 model（含 ChoicePicker）。
- 无 Button 的 ChoicePicker：`onChange` 即 POST，`name` 为 `"choice"`，`data` 含选中 value。
- 等待期间点发送：按钮 disabled，不发请求。
- 网络失败：现有 `host unreachable`。
- 重放：历史 surface 只读；仅当前等待态的 surface 可点。
- 不改 Files / Knowledge。

## 6. 数据流

1. Boot：yml 加载 a2ui → `provide` + `register a2ui_emit`。
2. 工作台 `POST /v1/turns` → `runTurn`（`channel: "host"`）。
3. 模型 `a2ui_emit` → 校验 → `tool/result` 短 JSON → `a2ui/surface` 进 log 与 SSE。
4. 若 wait：SSE `{ type:"end", status:"awaiting_action" }`；连接关掉；turn 仍开；UI 禁用发送。
5. 点击 → `POST /v1/turns/:id/actions` → `a2ui/action` → `continueTurn` → 新 SSE。
6. 模型看见 action 的 user JSON，继续 step；可再 emit 或纯文本结束（`turn/end` ok）。
7. CLI：`wait` 被忽略，step 按无 UI 继续直到结束。

## 7. 错误处理

| 情况 | 工具 / loop | HTTP / UI |
|---|---|---|
| 无 Bearer | — | 401 |
| 无 a2ui 插件 | 无该工具 | `POST /actions` 404 |
| emit 非法 / 未知组件 / 无 root / 坏 catalog / 过大 / 远程 URL | `failed: …`，无 surface 事件 | 聊天继续；无卡片 |
| 已 abort | `aborted` | 该 turn cancelled |
| 非等待态 actions | `continueTurn` 抛错 | 409 |
| action 缺字段 / 未知 surface | validate 失败 | 400 |
| 等待时刷新 | 无 `turn/end` + 最后 wait surface | 重放后仍禁用发送、按钮可点 |
| 等待时 SSE 断开 | **不** cancel | 同上 |
| 取消 | `turn/end cancelled` | 发送恢复；按钮只读 |
| 聊天失败 | 现有 `model/error` | 知识库 / Files 不受影响 |
| 知识库失败 | — | A2UI 不受影响 |

## 8. 安全

- 只绑 `127.0.0.1`；token 仍只在 Node 代理。
- 不渲染 HTML；Markdown 不当 HTML。
- 拒绝组件树里的 `http://` / `https://`。
- 不 fetch `catalogId`。
- API 密钥不进 session、SSE、yml、surface JSON。
- action / emit 64KiB 上限；options ≤ 20；messages ≤ 8。
- 工作区闸门与本片无关（a2ui 不读文件）。

## 9. 测试

全部不依赖真实 API key。假 chat 驱动 loop。

1. `validateEmit`：合法 Column+Text+Button → wait true；缺 root / 未知 `Chart` / 坏 catalogId / 过大 / `https://` → 失败。
2. `a2ui_emit`：缺 messages、abort、成功短 JSON **不含** messages 数组。
3. loop `channel: "host"` + wait → `awaiting_action`，events **无** `turn/end`；`channel: "cli"` + 同一 emit → `ok` 且有 `turn/end`。
4. `continueTurn`：append action，假 chat 回文本 → `ok` + `turn/end`；非等待态 → 抛错。
5. `deriveMessages` 含 action 的 user JSON，不含 surface 树。
6. HTTP：`/actions` 无 token 401；yml 无 a2ui → 404；等待中 200 SSE；结束后再 POST → 409。
7. 第一轮 SSE end `awaiting_action` 之后 **turn 仍可 cancel**（不因 `req.close` 被 abort）。
8. 桌面：mock SSE 出 surface + end awaiting_action → 可见按钮、发送 disabled；click 的 fetch URL 含 `/actions`；host src 全目录无 `@flintloom/a2ui`、`createA2uiEmitTool`。
9. 现有 `pnpm test`（知识库 / 预览 / loop / files）保持绿。

## 10. 与总 spec / 前切片的关系

总 spec §8 的 v1 目录本片只落地 text / markdown / button / choice（外加 Column / Row）。table / chart / infographic 仍留第三刀后续。§7 `POST /v1/turns/:id/actions` 与 SSE `a2ui.surface` 本片落地为 session 类型 `a2ui/surface`（斜杠风格与现有 `tool/call` 一致，SSE 原样转发）。

「用户操作会继续这一轮」解释为：同一 `turnId` + `continueTurn` + 新 SSE，而不是挂起第一轮 HTTP。

新 Loom 包必须 `apply`；禁止 `createRuntime` 里 `register`。

## 11. 实现顺序（本刀内）

1. `@flintloom/a2ui`：类型、validate、插件 + `a2ui_emit`（无 host）。
2. session 事件 + `deriveMessages`；loop `awaiting_action` + `continueTurn`。
3. host：`/actions`、SSE status、close 监听修复、yml、扫描。
4. 工作台内联 host + 等待态发送/取消。
5. 第 9 节验收测试全绿。
