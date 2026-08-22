# FlintLoom Guard ask Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** `guard.gate → ask` 时，工作台暂停 turn，用户允许/拒绝后执行或跳过工具，并续跑同一 turn。

**Architecture:** `tools` 抛 `GuardAskError`；`loop` 写 session 事件并 `awaiting_action`；host `POST /guard` 调 `continueGuardTurn`；desktop 确认气泡。非 host 仍当 deny。

**Tech Stack:** 现有 session / loop / tools / host SSE / desktop React。不新增 npm 包。

## Global Constraints

- 仅 `channel === "host"` 暂停；CLI/webhook/Telegram 的 `ask` 当 deny。
- 复用 SSE `awaiting_action`；确认 UI 只显示工具名，不显示 args。
- `ToolExec.guardBypass` 仅 loop 在用户允许后设置。
- host 不 import 新 Loom 包；`guard.ts` 与 `a2ui.ts` 同级。
- 失败文案不含密钥、token、绝对 homeDir。
- Windows：指定文件 `git add`；PowerShell `git commit -m @"` / `"@`；不用 `&&`。
- Spec：`docs/superpowers/specs/2026-08-22-flintloom-guard-ask-design.md`

## File map

```text
packages/session/src/events.ts
packages/session/src/session.ts
packages/session/tests/session.test.ts

packages/tools/src/types.ts              # guardBypass on ToolExec
packages/tools/src/guard-ask.ts          # GuardAskError
packages/tools/src/plugin.ts
packages/tools/src/index.ts
packages/tools/tests/guard-ask.test.ts

packages/loop/src/run-turn.ts
packages/loop/src/plugin.ts
packages/loop/tests/guard-ask.test.ts

apps/host/src/guard.ts
apps/host/src/server.ts
apps/host/tests/guard.test.ts

apps/desktop/src/types.ts
apps/desktop/src/api.ts
apps/desktop/src/App.tsx
apps/desktop/src/app.css
apps/desktop/tests/App.test.tsx
```

---

### Task 1: session 事件与 `isWaiting`

**Files:** `packages/session/src/events.ts`, `session.ts`, `tests/session.test.ts`

- [ ] **Step 1:** 增加 `guard/ask`、`guard/response` 事件类型；`isWaiting` 支持 guard 等待；`deriveMessages` 忽略这两种事件。
- [ ] **Step 2:** 测试：guard ask 无 response → waiting；response 后 → 不 waiting。
- [ ] **Step 3:** `pnpm exec vitest run packages/session`

---

### Task 2: `GuardAskError` 与 tools `pre-execute`

**Files:** `packages/tools/src/guard-ask.ts`, `types.ts`, `plugin.ts`, `index.ts`, `tests/guard-ask.test.ts`

- [ ] **Step 1:** `GuardAskError`；host+ask 抛出；非 host+ask 返回 deny 字符串；`guardBypass: true` 跳过 gate。
- [ ] **Step 2:** 测试通过后 commit task 1+2。

---

### Task 3: loop 暂停与 `continueGuardTurn`

**Files:** `packages/loop/src/run-turn.ts`, `plugin.ts`, `tests/guard-ask.test.ts`

- [ ] **Step 1:** `runSteps` catch `GuardAskError` → 写 `guard/decision`、`guard/ask`，返回 `awaiting_action`（无 `tool/result`）。
- [ ] **Step 2:** `continueGuardTurn`：写 `guard/response`；deny → `tool/result`；allow → `execute` with `guardBypass` → `tool/result` → `runSteps`。
- [ ] **Step 3:** mock guard 测试 allow/deny/cancel 路径。

---

### Task 4: host `POST /guard`

**Files:** `apps/host/src/guard.ts`, `server.ts`, `tests/guard.test.ts`

- [ ] **Step 1:** `handleTurnGuard` 路由；409/400；SSE 续跑。
- [ ] **Step 2:** 与 webhook 409、`cancel` 测试保持绿。

---

### Task 5: desktop 确认 UI

**Files:** `apps/desktop/src/types.ts`, `api.ts`, `App.tsx`, `app.css`, `tests/App.test.tsx`

- [ ] **Step 1:** `guard-ask` 气泡、允许/拒绝按钮、`postTurnGuard`；`waitingTurnId` 识别 guard。
- [ ] **Step 2:** App 测试 SSE 夹具。

---

### Task 6: 全量验证

- [ ] `pnpm test` / `pnpm typecheck` 全绿。

## Spec coverage

| Spec | Task |
|---|---|
| host ask 暂停 | 2, 3 |
| 非 host deny | 2 |
| guard/ask + guard/response | 1, 3 |
| guardBypass | 2, 3 |
| POST /guard | 4 |
| 只显示工具名 | 5 |
| awaiting_action 复用 | 3, 4, 5 |
| cancel / 409 | 4 |
