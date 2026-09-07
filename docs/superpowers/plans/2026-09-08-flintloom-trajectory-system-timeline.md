# FlintLoom Trajectory SYSTEM + 时间轴 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把实际送模的 system 记进 session log，轨迹增加 SYSTEM 行、只读三色时间轴和搜索；不造 CONTEXT，不改 Chat 观感。

**Architecture:** `appendEvent` 打 `time`；`runStepIterations` 在 `stream` 前按原文去重写入 `prompt/system`。桌面从事件投影 SYSTEM，并用 `step/start.time` / `tool/call.time` 作为开始时刻。时间轴一条水平条；缺 `time` 的旧 log 按回合顺序拼接并标 `inferred`。

**Tech Stack:** 现有 TypeScript 包、React 18 工作台、Vitest + jsdom。不新增依赖。

## Global Constraints

- 产品名 FlintLoom；包前缀 `@flintloom/*`。
- 不改 `ReasoningRow.tsx`、`foldLoopingReasoning.ts`、`toolDisplay.ts` 截断语义。
- 不扫描 AGENTS.md、不注入 workspace 文件、不记工具 schema。
- SYSTEM 标签英文；其它角色中文。
- 对话页卸载轨迹；`document.body` 在对话页不得出现 system 全文。
- 助手 `startedAt` 来自 `step/start.time`，工具来自 `tool/call.time`，禁止用 flush 末条事件时间。
- 点事件不撑 domain；CSS `min-width: 6px`。
- Windows 指定文件；用户未要求提交则跳过各 Task 的 commit 步。

Spec：`docs/superpowers/specs/2026-09-08-flintloom-trajectory-system-timeline-design.md`

## File map

```text
packages/session/src/events.ts
packages/session/src/session.ts
packages/session/tests/session.test.ts
packages/loop/src/run-turn.ts
packages/loop/tests/run-turn.test.ts
apps/desktop/src/types.ts
apps/desktop/src/trajectoryRecords.ts
apps/desktop/src/trajectoryTimeline.ts
apps/desktop/src/TrajectoryToolbar.tsx
apps/desktop/src/TrajectoryTimeline.tsx
apps/desktop/src/TrajectoryView.tsx
apps/desktop/src/TrajectoryTable.tsx
apps/desktop/src/TrajectoryInspector.tsx
apps/desktop/src/chatBubbles.ts
apps/desktop/src/App.tsx
apps/desktop/src/app.css
apps/desktop/tests/trajectoryRecords.test.ts
apps/desktop/tests/trajectoryTimeline.test.ts
apps/desktop/tests/TrajectoryView.test.tsx
apps/desktop/tests/App.test.tsx
```

---

### Task 1: SessionEvent 增加 `prompt/system` 与 `time`

**Files:**
- Modify: `packages/session/src/events.ts`
- Modify: `packages/session/src/session.ts`
- Test: `packages/session/tests/session.test.ts`

**Interfaces:**
- Produces: `export type SessionEvent = SessionEventBody & { time?: number }`，其中 `SessionEventBody` 含 `{ type: "prompt/system"; turnId: string; step: number; text: string }`
- Produces: `deriveMessages()` 遇到 `prompt/system` 跳过，不投影 `role: "system"`

- [ ] **Step 1: 写失败测试**

在 `packages/session/tests/session.test.ts` 追加：

```ts
  it("deriveMessages ignores prompt/system and does not emit a system role", () => {
    const session = new Session("s-prompt");
    session.append({ type: "user/message", text: "hello" });
    session.append({
      type: "prompt/system",
      turnId: "t1",
      step: 1,
      text: "You are FlintLoom",
    });
    session.append({ type: "assistant/message", text: "hi" });

    expect(session.deriveMessages()).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ]);
    expect(session.deriveMessages().some((m) => m.role === "system")).toBe(false);
    expect(session.events().some((e) => e.type === "prompt/system")).toBe(true);
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run packages/session/tests/session.test.ts`

Expected: FAIL，`prompt/system` 不是 `SessionEvent`。

- [ ] **Step 3: 改类型与 `deriveMessages`**

`events.ts`：把现有联合改名为 `SessionEventBody`，增加 `prompt/system` 成员，然后：

```ts
export type SessionEvent = SessionEventBody & { time?: number };
```

`session.ts` 的 `switch (event.type)` 增加：

```ts
        case "prompt/system":
          break;
```

- [ ] **Step 4: 再跑测试**

Run: `pnpm exec vitest run packages/session/tests/session.test.ts`

Expected: PASS。

- [ ] **Step 5: 跳过 commit**（用户未要求提交）

---

### Task 2: `appendEvent` 打 `time`，`stream` 前去重写入 `prompt/system`

**Files:**
- Modify: `packages/loop/src/run-turn.ts`
- Test: `packages/loop/tests/run-turn.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `prompt/system`
- Produces: 每条经 `appendEvent` 的事件在缺 `time` 时带 `time: number`；`prompt/system.text ===` 即将 `stream` 的 `messages[0].content`

- [ ] **Step 1: 写失败测试**

在 `run-turn.test.ts` 追加（沿用文件里的 `boot()`）：

```ts
  it("logs prompt/system equal to the streamed system message and dedupes until it changes", async () => {
    const systems: string[] = [];
    const fakeChat: ChatProvider = {
      async *stream(req) {
        const first = req.messages[0];
        systems.push(typeof first?.content === "string" ? first.content : "");
        yield { type: "text", text: "ok" };
      },
    };
    const ctx = boot();
    ctx.require<ModelRegistry>("models").registerChat("fake", fakeChat);
    ctx.require<ModelRegistry>("models").setDefault("chat", "fake");
    const session = new Session("s-prompt-sys");
    await runTurn({
      ctx,
      session,
      text: "hello",
      workspaceRoot: process.cwd(),
      channel: "test",
      signal: new AbortController().signal,
    });
    const first = session.events().filter((e) => e.type === "prompt/system");
    expect(first).toHaveLength(1);
    expect(first[0]?.text).toBe(systems[0]);
    expect(first[0]?.text).toContain("You are FlintLoom");
    expect(first[0]?.step).toBe(1);
    expect(typeof first[0]?.time).toBe("number");

    await runTurn({
      ctx,
      session,
      text: "again",
      workspaceRoot: process.cwd(),
      channel: "test",
      signal: new AbortController().signal,
    });
    expect(session.events().filter((e) => e.type === "prompt/system")).toHaveLength(1);

    await runTurn({
      ctx,
      session,
      text: "search it",
      webSearch: true,
      workspaceRoot: process.cwd(),
      channel: "test",
      signal: new AbortController().signal,
    });
    const all = session.events().filter((e) => e.type === "prompt/system");
    expect(all).toHaveLength(2);
    expect(all[1]?.text).toBe(systems[2]);
    expect(all[1]?.text).toContain("You may call web_search");
  });

  it("does not log prompt/system when chat provider is missing", async () => {
    const ctx = boot();
    const session = new Session("s-no-chat");
    const result = await runTurn({
      ctx,
      session,
      text: "hello",
      workspaceRoot: process.cwd(),
      channel: "test",
      signal: new AbortController().signal,
    });
    expect(result.status).toBe("failed");
    expect(session.events().some((e) => e.type === "prompt/system")).toBe(false);
  });
```

把同文件里对 `assistant/message` / `user/message` 的 `.toEqual({ type, ... })` 改成 `.toMatchObject({ type, ... })`，否则打上 `time` 后会红。目前至少两处：`from-omni`、`what is this` 图片、`from-chat`。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run packages/loop/tests/run-turn.test.ts`

Expected: 新用例 FAIL（没有 `prompt/system`）。

- [ ] **Step 3: 实现**

`appendEvent`：

```ts
function appendEvent(
  session: Session,
  onEvent: RunTurnInput["onEvent"],
  event: SessionEvent,
): void {
  const stamped = event.time === undefined ? { ...event, time: Date.now() } : event;
  session.append(stamped);
  onEvent?.(stamped);
}
```

在 `run-turn.ts` 增加：

```ts
function lastPromptSystemText(session: Session): string | undefined {
  let text: string | undefined;
  for (const event of session.events()) {
    if (event.type === "prompt/system") text = event.text;
  }
  return text;
}
```

在 `runStepIterations` 里，`resolveConversationProvider` **成功之后**、`const messages = [...]` **之后**、`chatProvider.stream` **之前**：

```ts
    const systemText = conversationSystemMessage(
      input.webSearch === true,
      generationDirOf(input.session),
    );
    const messages = [
      { role: "system" as const, content: systemText },
      ...session.deriveMessages(),
    ];
    if (lastPromptSystemText(session) !== systemText) {
      appendEvent(session, onEvent, {
        type: "prompt/system",
        turnId,
        step: stepNumber,
        text: systemText,
      });
    }
```

不要在解析 provider 失败的分支写 `prompt/system`。

- [ ] **Step 4: 再跑测试**

Run: `pnpm exec vitest run packages/loop/tests/run-turn.test.ts packages/loop/tests/generationDir.test.ts packages/loop/tests/guard-ask.test.ts`

Expected: PASS。若还有 `.toEqual` 因 `time` 失败，同样改 `toMatchObject`。

- [ ] **Step 5: 跳过 commit**

---

### Task 3: 桌面类型 + `buildTrajectoryFromEvents` 投影 SYSTEM 与 startedAt

**Files:**
- Modify: `apps/desktop/src/types.ts`
- Modify: `apps/desktop/src/trajectoryRecords.ts`
- Test: `apps/desktop/tests/trajectoryRecords.test.ts`

**Interfaces:**
- Consumes: `prompt/system`、可选 `time`
- Produces: `TrajectoryKind` 含 `"system"`；`TrajectoryRecord.startedAt?: number`；`recordMatchesQuery(record, query)`

- [ ] **Step 1: 写失败测试**

追加到 `trajectoryRecords.test.ts`：

```ts
  it("inserts SYSTEM after USER and uses step/start.time as assistant startedAt", () => {
    const rows = buildTrajectoryFromEvents([
      { type: "turn/start", turnId: "t1", startedAt: 1000, time: 1000 },
      { type: "user/message", text: "hi", time: 1001 },
      { type: "step/start", turnId: "t1", step: 1, time: 1100 },
      {
        type: "prompt/system",
        turnId: "t1",
        step: 1,
        text: "You are FlintLoom unique-sys-token",
        time: 1101,
      },
      { type: "assistant/chunk", text: "hello", time: 1200 },
      {
        type: "step/stats",
        turnId: "t1",
        step: 1,
        llmMs: 80,
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        time: 1180,
      },
      { type: "assistant/message", text: "hello", time: 1181 },
    ]);
    expect(rows.map((r) => r.kind)).toEqual(["user", "system", "assistant"]);
    expect(rows[1]?.id).toBe("system:t1:1");
    expect(rows[1]?.output).toBe("You are FlintLoom unique-sys-token");
    expect(rows[1]?.startedAt).toBe(1101);
    expect(rows[2]?.startedAt).toBe(1100);
    expect(rows[2]?.timing?.llmMs).toBe(80);
    expect(rows[0]?.startedAt).toBe(1001);
  });

  it("uses tool/call.time as tool startedAt", () => {
    const rows = buildTrajectoryFromEvents([
      { type: "tool/call", callId: "c1", name: "fs", args: {}, time: 50 },
      { type: "tool/result", callId: "c1", name: "fs", text: "ok", durationMs: 9, time: 59 },
    ]);
    expect(rows[0]?.startedAt).toBe(50);
    expect(rows[0]?.timing?.durationMs).toBe(9);
  });
```

再加 `recordMatchesQuery` 用例（实现放在 `trajectoryRecords.ts`）：

```ts
  it("recordMatchesQuery is case-insensitive over system output", () => {
    const row = buildTrajectoryFromEvents([
      { type: "prompt/system", turnId: "t1", step: 1, text: "AlphaToken" },
    ])[0]!;
    expect(recordMatchesQuery(row, "alphatoken")).toBe(true);
    expect(recordMatchesQuery(row, "zzz")).toBe(false);
    expect(recordMatchesQuery(row, "  ")).toBe(true);
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run apps/desktop/tests/trajectoryRecords.test.ts`

Expected: FAIL。

- [ ] **Step 3: 实现**

`types.ts`：现有联合改名为 `WorkbenchEventBody`，增加

```ts
  | { type: "prompt/system"; turnId: string; step: number; text: string }
```

以及 `export type WorkbenchEvent = WorkbenchEventBody & { time?: number };`（`TurnEnd` 并进 Body）。

`trajectoryRecords.ts`：

- `TrajectoryKind` 加 `"system"`。
- `TrajectoryRecord` 加 `startedAt?: number`。
- 循环里用 `let stepStartedAt: number | undefined`，`step/start` 时若 `event.time !== undefined` 则记下。
- `flushAssistant` 把 `stepStartedAt` 写入行。
- `tool/call` 把 `event.time` 写入行的 `startedAt`。
- `case "prompt/system"`：`flushAssistant(false)`，push `{ id: \`system:${event.turnId}:${event.step}\`, kind: "system", output: event.text, preview: previewLine(event.text), startedAt: event.time, turn, turnId, step: event.step }`，并 `markTurnStart`。
- 导出：

```ts
export function recordMatchesQuery(record: TrajectoryRecord, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return true;
  const parts = [
    record.preview,
    record.thinking,
    record.output,
    record.result,
    record.toolName,
  ];
  try {
    parts.push(JSON.stringify(record.args ?? ""));
  } catch {
    /* skip args */
  }
  return parts.some((part) => part !== undefined && part.toLowerCase().includes(q));
}
```

- [ ] **Step 4: 再跑测试**

Run: `pnpm exec vitest run apps/desktop/tests/trajectoryRecords.test.ts`

Expected: PASS。现有用例不因多字段失败。

- [ ] **Step 5: 跳过 commit**

---

### Task 4: 账本 / 详情渲染 SYSTEM

**Files:**
- Modify: `apps/desktop/src/TrajectoryTable.tsx`
- Modify: `apps/desktop/src/TrajectoryInspector.tsx`
- Test: `apps/desktop/tests/TrajectoryView.test.tsx`

**Interfaces:**
- Consumes: `kind: "system"`、`output`、`startedAt`
- Produces: 标签 `SYSTEM`；详情默认摘要，有 `startedAt` 时有耗时页签（只显示时刻）

- [ ] **Step 1: 写失败测试**

`TrajectoryView.test.tsx` 追加一条 record 并测试：

```ts
  it("shows SYSTEM tag and summary for system records", () => {
    mount(
      <TrajectoryView
        records={[
          {
            id: "system:t1:1",
            kind: "system",
            turn: 1,
            step: 1,
            preview: "You are FlintLoom",
            output: "You are FlintLoom full",
            startedAt: 1_700_000_000_000,
          },
        ]}
      />,
    );
    const row = container?.querySelector('[data-trajectory-id="system:t1:1"]');
    expect(row?.textContent).toContain("SYSTEM");
    act(() => {
      (row as HTMLElement).click();
    });
    expect(container?.querySelector("[data-inspector-panel]")?.textContent).toContain(
      "You are FlintLoom full",
    );
    expect(container?.querySelector("[data-inspector-tab='timing']")).toBeTruthy();
    cleanup();
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run apps/desktop/tests/TrajectoryView.test.tsx`

Expected: FAIL（`KIND_LABEL` 无 system）。

- [ ] **Step 3: 实现**

`TrajectoryTable.tsx` / `TrajectoryInspector.tsx` 的 `KIND_LABEL` 增加 `system: "SYSTEM"`。

`availableTabs`：`kind === "system"` 时 `summary`，若 `startedAt !== undefined` 再加 `timing`。

`TimingPanel`：若 `record.startedAt` 有值，增加一行 `Started` = `new Date(startedAt).toLocaleTimeString()`。为此把 `TimingPanel` 改成接收 `record` 或额外 `startedAt`。SYSTEM 没有 `timing.llmMs` 也可以只靠 `startedAt` 出页签。

`defaultInspectorTab`：system → `summary`。

- [ ] **Step 4: 再跑测试**

Run: `pnpm exec vitest run apps/desktop/tests/TrajectoryView.test.tsx`

Expected: PASS。

- [ ] **Step 5: 跳过 commit**

---

### Task 5: Chat 忽略 `prompt/system`，对话页不泄漏全文

**Files:**
- Modify: `apps/desktop/src/chatBubbles.ts`
- Modify: `apps/desktop/src/App.tsx`
- Test: `apps/desktop/tests/App.test.tsx`
- Test: 若有 `apps/desktop/tests/chatBubbles.test.ts`，补一条忽略用例

**Interfaces:**
- Consumes: `prompt/system`
- Produces: 气泡路径不渲染 system；对话页无轨迹则 `document.body` 不含 system 全文

- [ ] **Step 1: 写失败测试**

`App.test.tsx` 追加（照现有 `installFetch` / `mountApp` / `typeAndSend`）：

```ts
  it("does not leak prompt/system into chat and shows SYSTEM on trajectory", async () => {
    const systemText = "You are FlintLoom leaked-system-token";
    const sse =
      `data: ${JSON.stringify({ type: "turn/start", turnId: "t1", startedAt: 1 })}\n\n` +
      `data: ${JSON.stringify({ type: "user/message", text: "hello" })}\n\n` +
      `data: ${JSON.stringify({ type: "step/start", turnId: "t1", step: 1 })}\n\n` +
      `data: ${JSON.stringify({ type: "prompt/system", turnId: "t1", step: 1, text: systemText })}\n\n` +
      `data: ${JSON.stringify({ type: "assistant/message", text: "hi-there" })}\n\n` +
      `data: ${JSON.stringify({ type: "end", status: "ok" })}\n\n`;
    installFetch({
      turn: new Response(sse, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    });
    await mountApp();
    await typeAndSend("hello");
    await waitForText("hi-there");
    expect(document.querySelector(".trajectory-root")).toBeNull();
    expect(document.body.textContent).not.toContain("leaked-system-token");

    const trajTab = [...document.querySelectorAll('[role="tab"]')].find((el) => el.textContent === "轨迹");
    await act(async () => {
      (trajTab as HTMLButtonElement).click();
    });
    expect(document.body.textContent).toContain("leaked-system-token");
    expect(document.querySelector('[data-trajectory-id="system:t1:1"]')).toBeTruthy();
  });
```

- [ ] **Step 2: 跑测试确认失败或泄漏**

Run: `pnpm exec vitest run apps/desktop/tests/App.test.tsx`

Expected: 新用例 FAIL，或 `body` 已含 token（若 `bubbleFromHistory` 误渲染）。

- [ ] **Step 3: 实现**

`chatBubbles.ts` 把 skip 列表改成包含 `prompt/system`：

```ts
    if (
      event.type === "turn/start" ||
      event.type === "guard/decision" ||
      event.type === "guard/response" ||
      event.type === "step/stats" ||
      event.type === "prompt/system"
    ) {
      continue;
    }
```

`App.tsx` `handleEvent` 在 `step/stats` 旁：

```ts
    if (event.type === "prompt/system") {
      return;
    }
```

（仍要先 `eventsRef.push` 与 `scheduleTrajectory`。）

- [ ] **Step 4: 再跑测试**

Run: `pnpm exec vitest run apps/desktop/tests/App.test.tsx apps/desktop/tests/chatBubbles.test.ts`

Expected: PASS。现有截断 / 轨迹跳转仍绿。

- [ ] **Step 5: 跳过 commit**

---

### Task 6: `deriveTrajectoryTimeline`

**Files:**
- Create: `apps/desktop/src/trajectoryTimeline.ts`
- Test: `apps/desktop/tests/trajectoryTimeline.test.ts`

**Interfaces:**
- Consumes: `TrajectoryRecord`（`startedAt`、`timing.llmMs` / `timing.durationMs`、`kind`）
- Produces:

```ts
export type TimelineLane = "input" | "model" | "tools";
export type TrajectoryTimelineSpan = {
  recordId: string;
  lane: TimelineLane;
  startMs: number;
  durationMs: number;
  inferred: boolean;
};
export type TrajectoryTimelineModel = {
  domainMs: number;
  spans: TrajectoryTimelineSpan[];
};
export function deriveTrajectoryTimeline(
  records: readonly TrajectoryRecord[],
): TrajectoryTimelineModel | undefined;
```

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from "vitest";
import { deriveTrajectoryTimeline } from "../src/trajectoryTimeline.ts";
import type { TrajectoryRecord } from "../src/trajectoryRecords.ts";

describe("deriveTrajectoryTimeline", () => {
  it("places assistant and tool by real startedAt", () => {
    const records: TrajectoryRecord[] = [
      { id: "sys", kind: "system", turn: 1, preview: "s", startedAt: 1000 },
      {
        id: "a",
        kind: "assistant",
        turn: 1,
        preview: "x",
        startedAt: 1100,
        timing: { llmMs: 80 },
      },
      {
        id: "t",
        kind: "tool",
        turn: 1,
        preview: "y",
        startedAt: 1180,
        timing: { durationMs: 20 },
      },
    ];
    const model = deriveTrajectoryTimeline(records);
    expect(model?.spans.find((s) => s.recordId === "a")).toMatchObject({
      lane: "model",
      startMs: 100,
      durationMs: 80,
      inferred: false,
    });
    expect(model?.spans.find((s) => s.recordId === "t")).toMatchObject({
      lane: "tools",
      startMs: 180,
      durationMs: 20,
      inferred: false,
    });
    expect(model?.domainMs).toBe(200);
  });

  it("packs timed rows without startedAt and marks inferred", () => {
    const records: TrajectoryRecord[] = [
      { id: "a", kind: "assistant", turn: 1, preview: "x", timing: { llmMs: 50 } },
      { id: "t", kind: "tool", turn: 1, preview: "y", timing: { durationMs: 10 } },
    ];
    const model = deriveTrajectoryTimeline(records);
    expect(model?.spans).toEqual([
      { recordId: "a", lane: "model", startMs: 0, durationMs: 50, inferred: true },
      { recordId: "t", lane: "tools", startMs: 50, durationMs: 10, inferred: true },
    ]);
    expect(model?.domainMs).toBe(60);
  });

  it("does not inflate domain for point events", () => {
    const model = deriveTrajectoryTimeline([
      { id: "u", kind: "user", turn: 1, preview: "hi", startedAt: 5 },
      { id: "s", kind: "system", turn: 1, preview: "sys", startedAt: 5 },
    ]);
    expect(model?.domainMs).toBe(1);
    expect(model?.spans.every((s) => s.durationMs === 0)).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run apps/desktop/tests/trajectoryTimeline.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现**

规则（与 spec §7 一致）：

- 入选：`system`/`user`，或 assistant 有 `timing.llmMs`，或 tool 有 `timing.durationMs`。
- 有 `startedAt`：绝对时间，`inferred: false`。`startMs` 相对 `min(startedAt)`。
- 否则：按数组顺序拼接，起点 0，`inferred: true`。点事件（无 duration）时长 0，不推进游标。
- 若同一批里部分有 `startedAt`、部分没有：有 `startedAt` 的用绝对时钟；没有的接到「已放置段的最大 end」之后（仍标 `inferred`）。实现时先处理有 `startedAt` 的以定 domain 起点，再把无 `startedAt` 的接到 `maxEnd`。测试 2 全无 `startedAt`，从 0 拼即可。
- `domainMs = max(1, maxEnd - minStart)`。
- 无入选行：`return undefined`。

- [ ] **Step 4: 再跑测试**

Run: `pnpm exec vitest run apps/desktop/tests/trajectoryTimeline.test.ts`

Expected: PASS。

- [ ] **Step 5: 跳过 commit**

---

### Task 7: 顶栏时间轴 + 搜索

**Files:**
- Create: `apps/desktop/src/TrajectoryToolbar.tsx`
- Create: `apps/desktop/src/TrajectoryTimeline.tsx`
- Modify: `apps/desktop/src/TrajectoryView.tsx`
- Modify: `apps/desktop/src/app.css`
- Test: `apps/desktop/tests/TrajectoryView.test.tsx`

**Interfaces:**
- Consumes: `deriveTrajectoryTimeline`、`recordMatchesQuery`
- Produces: 搜索框 `aria-label="搜索轨迹"`；时间轴 `data-timeline-id={recordId}`；无匹配文案「无匹配」

- [ ] **Step 1: 写失败测试**

在 `TrajectoryView.test.tsx` 追加：

```ts
  it("filters ledger by search and selects a row from the timeline", () => {
    mount(
      <TrajectoryView
        records={[
          {
            id: "system:t1:1",
            kind: "system",
            turn: 1,
            preview: "You are FlintLoom",
            output: "unique-sys-only",
            startedAt: 1000,
          },
          {
            id: "assistant:t1:1",
            kind: "assistant",
            turn: 1,
            preview: "hello",
            output: "hello",
            startedAt: 1100,
            timing: { llmMs: 80 },
          },
        ]}
      />,
    );
    const search = container?.querySelector('[aria-label="搜索轨迹"]') as HTMLInputElement;
    act(() => {
      search.value = "unique-sys-only";
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container?.querySelector('[data-trajectory-id="assistant:t1:1"]')).toBeNull();
    expect(container?.querySelector('[data-trajectory-id="system:t1:1"]')).toBeTruthy();

    act(() => {
      search.value = "";
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const span = container?.querySelector('[data-timeline-id="assistant:t1:1"]') as HTMLElement;
    act(() => {
      span.click();
    });
    expect(
      container?.querySelector('[data-trajectory-id="assistant:t1:1"]')?.getAttribute("aria-selected"),
    ).toBe("true");
    cleanup();
  });
```

若受控 input 必须用 `fireEvent` / 设 state，改成对 input 触发 React 能收到的 `onChange`（`{ target: { value } }`）。与仓库其它 input 测试对齐。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run apps/desktop/tests/TrajectoryView.test.tsx`

Expected: FAIL，无搜索框。

- [ ] **Step 3: 实现**

`TrajectoryToolbar`：受控 `<input type="search" aria-label="搜索轨迹" placeholder="搜索" />`。

`TrajectoryTimeline`：一条 `.trajectory-timeline`，每个 span `position:absolute; left: start/domain%; width: duration/domain%`，`min-width: 6px`，`data-timeline-id`，`data-lane`，点击 `onSelect`。

`TrajectoryView`：

```ts
  const [query, setQuery] = useState("");
  const visible = records.filter((row) => recordMatchesQuery(row, query));
  const timeline = deriveTrajectoryTimeline(visible);
```

空 `records` 仍是「尚无轨迹」。`records.length > 0 && visible.length === 0` 显示「无匹配」。选中 id 不在 `visible` 时当作未选中（关掉详情）。

CSS 只用 `.trajectory-toolbar` / `.trajectory-timeline` / `.trajectory-timeline-span`，颜色按 spec：input 中性、model `--logo-gradient-end`、tools 现有 success。

- [ ] **Step 4: 再跑相关测试**

Run: `pnpm exec vitest run apps/desktop/tests/TrajectoryView.test.tsx apps/desktop/tests/App.test.tsx apps/desktop/tests/trajectoryRecords.test.ts apps/desktop/tests/trajectoryTimeline.test.ts`

Expected: PASS。

- [ ] **Step 5: 跳过 commit**

---

## Self-review

| Spec 要求 | Task |
|---|---|
| `prompt/system` + `time` | 1, 2 |
| 去重 / 联网第二条 / 缺模型不写 | 2 |
| `deriveMessages` 不投影 system | 1 |
| SYSTEM 行与 startedAt 映射 | 3, 4 |
| Chat 不泄漏 | 5 |
| 时间轴真实 / 推断 / 点事件 | 6, 7 |
| 搜索 | 3（函数）, 7（UI） |

无 TBD。类型名 `prompt/system`、`deriveTrajectoryTimeline`、`recordMatchesQuery` 前后一致。
