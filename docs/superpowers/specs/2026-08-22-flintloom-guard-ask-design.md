# FlintLoom Guard ask 切片设计

日期：2026-08-22  
状态：已审阅  
产品：FlintLoom — A real agent. / 真正的 Agent。  
范围：总 spec 第 7 刀：**guard `ask` 暂停 + 工作台确认**。不改 `runTurn` 整体结构，不加 guard 模型包，不加 steward。

## 1. 这是什么

已配置 `guard` provider 时，`gate` 返回 `ask` 不再立刻当 deny。在 **`channel === "host"`**（工作台）上：记下 `tool/call` 后暂停 turn，SSE 结束帧 `awaiting_action`；用户点「允许」则执行该工具并续跑，点「拒绝」或「取消」则写入 `guard denied` 的 `tool/result` 并续跑（拒绝）或 `turn/end cancelled`（取消）。

**非 host**（CLI / webhook / Telegram）：`ask` 仍等价 **deny**，文案 `guard denied: <tool>`，与现网 stub 一致，不暂停。

验收：测试里 mock `guard.gate → ask`；`pnpm desktop` 或 host 测试出现确认条，允许后 `tool/result` 含真实输出；拒绝后不执行工具进程。自动化不依赖真实 guard 模型。

## 2. 收紧的决策

| 点 | 决定 |
|---|---|
| 通道 | 仅 `host` 暂停。其它 channel：`ask` → 当 `deny`，不新增事件 `guard/ask`。 |
| 状态码 | 复用 `awaiting_action`（与 A2UI 相同 SSE `end` 帧）。不新增 `awaiting_guard`。 |
| 等待判定 | `session.isWaiting(turnId)` = A2UI 等待 **或** guard 等待（见下）。 |
| guard 等待 | 本 turn 已 `turn/start`、未 `turn/end`；存在 `guard/ask` 且**无**同 `callId` 的 `guard/response`。 |
| 事件 | 新增 `guard/ask` `{ turnId, callId, tool }`、`guard/response` `{ turnId, callId, decision: "allow" \| "deny" }`。`ask` 时另写 `guard/decision` `{ tool, decision: "ask" }`。 |
| 参数展示 | 工作台确认 UI **只显示工具名**，不展示 `args`（防路径/密钥泄露）。 |
| 执行路径 | `ask` 时 **不**写 `tool/result`。允许：`tools.execute` 带 `guardBypass: true` 跳过 `pre-execute` 里的 gate，写 `tool/result`。拒绝：写 `tool/result` 文本 `guard denied: <tool>`，不执行工具。 |
| 信号 | `GuardAskError`（`@flintloom/tools`）由 `pre-execute` 在 host+ask 时抛出；`ToolRegistry.execute` 原样抛出，不包成普通字符串。 |
| 续跑 API | 新路由 `POST /v1/turns/:turnId/guard`，body `{ callId, decision: "allow" \| "deny" }`。与 `/actions` 分开。 |
| loop | 新 `continueGuardTurn`（或 `LoopService` 同接口扩展）。`continueTurn` 仍只服务 A2UI。 |
| 取消 | 现有 `POST /v1/turns/:id/cancel`：`isWaiting` 含 guard 等待时写 `turn/end cancelled`（与 A2UI 相同）。 |
| 并发 | guard 等待中再 POST `/turns` 或 webhook → 409（沿用 `sessionHasWaitingTurn`）。 |
| steward | 本片 **不**做执行后 steward。 |
| 新包 | **不**新增 `@flintloom/models-guard`；测试用 mock `GuardProvider`。 |

## 3. 非目标

- guard 模型 provider、steward、自动卸插件
- CLI / webhook / Telegram 上的用户确认 UI
- 工作台展示工具参数 JSON
- A2UI table/chart、桌面插件页、MCP 改动
- 改 `flintloom.yml` 默认组装

## 4. 架构

```text
runSteps
  append tool/call
  try tools.execute(...)
    pre-execute: guard.gate
      deny (any channel) → return "guard denied: …"
      ask + channel !== host → return "guard denied: …"
      ask + host → throw GuardAskError
  catch GuardAskError
    append guard/decision ask
    append guard/ask { turnId, callId, tool }
    return { status: awaiting_action }   // 无 turn/end

POST /v1/turns/:id/guard { callId, decision }
  append guard/response
  decision deny → append tool/result "guard denied: …"
  decision allow → tools.execute(..., { guardBypass: true })
  → runSteps 续跑

desktop
  guard/ask 气泡 + 允许/拒绝
  awaiting_action 时禁用发送（与 A2UI 共用 waitingAction）
```

host **不** import 新 Loom 包。`apps/host/src` 新增 `guard.ts`（与 `a2ui.ts` 并列）处理 `/guard` 路由。

## 5. 组件

### 5.1 session

- `SessionEvent` 增加 `guard/ask`、`guard/response`。
- `isWaiting`：在 A2UI 分支之外，若 guard 等待也为 true。
- `deriveMessages`：`guard/ask` / `guard/response` **不进** chat 历史（与 `a2ui/surface` 类似）；拒绝后的 `tool/result` 照常进历史。

### 5.2 tools

- `ToolExec` 增加可选 `guardBypass?: boolean`。
- `GuardAskError`：`callId` 可选由 loop 在 catch 后关联；抛出时含 `tool`。
- `packages/tools` 的 `pre-execute`：见上表。

### 5.3 loop

- `run-turn.ts`：`GuardAskError` → 暂停逻辑。
- `continueGuardTurn(input: { turnId, callId, decision, ... })`。
- `LoopService` 类型扩展。`plugin` provide 导出。

### 5.4 host

- `handleTurnGuard`：`POST /v1/turns/:id/guard`，校验 `isWaiting`、guard 等待、`callId` 匹配 pending `guard/ask`。
- `streamLoopResult` 对 guard 续跑同样 SSE。
- `sessionHasWaitingTurn` / `cancelWaitingTurn` 依赖更新后的 `isWaiting`。

### 5.5 desktop

- `WorkbenchEvent` 增加 `guard/ask`、`guard/response`。
- 新气泡 `guard-ask`：文案如 `Guard 请求执行工具：shell` + 按钮「允许」「拒绝」。
- `postTurnGuard(turnId, { callId, decision })`。
- `waitingTurnId`：识别 guard 等待（刷新后仍显示 waiting）。

## 6. 错误处理

| 情况 | 行为 |
|---|---|
| 未配置 guard | 与现网相同，无 `guard/ask` |
| ask + CLI | `guard denied`，turn 继续 |
| 允许后工具失败 | 正常 `tool/result` 或错误文案 |
| 非法 callId / 非等待态 POST /guard | 400 / 409 |
| 取消 | `turn/end cancelled`，未执行的工具无 `tool/result` |

失败文案不含 API key、env 值、绝对 `homeDir`。

## 7. 测试

1. `tools`：host+ask 抛 `GuardAskError`；CLI+ask 当 deny。`guardBypass` 跳过 gate。  
2. `session`：`isWaiting` guard 路径；`guard/response` 后不再等待。  
3. `loop`：mock ask → `awaiting_action`；allow 执行工具；deny 无执行。  
4. `host`：`/guard` SSE；cancel；409 与 webhook 现有用例仍绿。  
5. `desktop`：`App.test.tsx` guard 气泡与按钮（SSE 夹具）。  
6. `pnpm test` / `typecheck` 全绿。

## 8. 总 spec 对接

- 第 4.3 节 gate `ask`：本片在 host 落地暂停确认。  
- 第 13 节桌面：`guard.deny` 不启动工具；本片 `ask` 暂停亦不启动，直到用户允许。  
- 第 16 节：第 7 刀为本片。A2UI table/chart、桌面插件页仍后续。
