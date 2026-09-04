# FlintLoom Trajectory 检查台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对话页增加「对话 | 轨迹」选项卡：轨迹从 `WorkbenchEvent[]` 投影密账本 + 本地详情，Chat 的思考抽屉和工具行观感不变。

**Architecture:** `eventsRef` 旁路记录 SSE / `fetchSession` 事件；`buildTrajectoryFromEvents` 纯函数出 `TrajectoryRecord[]`；仅轨迹页可见时 rAF 刷新。Chat `.log` 在轨迹页 `hidden`+`inert` 保活；对话页卸载轨迹以免全文泄漏。`ToolCallRow` 用独立按钮跳转，不抢展开。

**Tech Stack:** 现有 React 18 + Vite 工作台、Vitest + jsdom。不新增依赖。

## Global Constraints

- 产品名 FlintLoom；包前缀 `@flintloom/*`。
- 不改 `ReasoningRow.tsx`、`foldLoopingReasoning.ts`、`chatBubbles.ts`；不改 `toolDisplay.ts` 的截断/折叠语义。
- `handleEvent` 气泡增量路径保持原样；只在函数入口追加 `eventsRef` / 轨迹调度 / guard 切回。
- 轨迹 CSS 只用 `.trajectory-*` 与 `.chat-view-tabs`，不复用 `.disclosure-row` / `.reasoning-drawer`。
- 对话页默认选中「对话」；对话页 `document.body` 不得出现轨迹账本全文。
- ASSISTANT 必须合并 `assistant/reasoning-chunk` + `assistant/chunk`；有 tool 无 `assistant/message` 时仍要有 ASSISTANT 行。
- 轨迹详情：thinking 原文、tool result 全文。账本预览才截断。
- Windows 提交指定文件；不要 `git add -A`。用户未要求提交时可跳过各 Task 的 commit 步。

Spec：`docs/superpowers/specs/2026-08-30-flintloom-trajectory-design.md`

## File map

```text
apps/desktop/src/trajectoryRecords.ts
apps/desktop/src/TrajectoryTable.tsx
apps/desktop/src/TrajectoryInspector.tsx
apps/desktop/src/TrajectoryView.tsx
apps/desktop/src/App.tsx
apps/desktop/src/ToolCallRow.tsx
apps/desktop/src/app.css
apps/desktop/tests/trajectoryRecords.test.ts
apps/desktop/tests/TrajectoryView.test.tsx
apps/desktop/tests/ToolCallRow.test.tsx
apps/desktop/tests/App.test.tsx
```

---

### Task 1: `buildTrajectoryFromEvents`

**Files:**
- Create: `apps/desktop/src/trajectoryRecords.ts`
- Create: `apps/desktop/tests/trajectoryRecords.test.ts`

**Interfaces:**
- Consumes: `WorkbenchEvent`（`apps/desktop/src/types.ts`）、`toolDisplayTitle` / `toolDisplaySummary` / `toolResultState`（`toolDisplay.ts`）
- Produces: `TrajectoryRecord`、`TrajectoryKind`、`TrajectoryTiming`、`previewLine`、`buildTrajectoryFromEvents(events)`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from "vitest";
import { buildTrajectoryFromEvents } from "../src/trajectoryRecords.ts";
import type { WorkbenchEvent } from "../src/types.ts";

describe("buildTrajectoryFromEvents", () => {
  it("merges reasoning and text chunks into one assistant row per step", () => {
    const events: WorkbenchEvent[] = [
      { type: "turn/start", turnId: "t1", startedAt: 1 },
      { type: "user/message", text: "hi" },
      { type: "step/start", turnId: "t1", step: 1 },
      { type: "assistant/reasoning-chunk", text: "think-a" },
      { type: "assistant/chunk", text: "hello" },
      { type: "assistant/message", text: "hello" },
      { type: "turn/end", turnId: "t1", status: "ok" },
    ];
    const rows = buildTrajectoryFromEvents(events);
    expect(rows.map((r) => r.kind)).toEqual(["user", "assistant"]);
    expect(rows[0]?.turnStart).toBe(true);
    expect(rows[0]?.turn).toBe(1);
    expect(rows[1]?.id).toBe("assistant:t1:1");
    expect(rows[1]?.thinking).toBe("think-a");
    expect(rows[1]?.output).toBe("hello");
    expect(rows[1]?.running).toBeFalsy();
  });

  it("keeps an assistant row when a tool step has chunks but no assistant/message", () => {
    const events: WorkbenchEvent[] = [
      { type: "turn/start", turnId: "t1", startedAt: 1 },
      { type: "step/start", turnId: "t1", step: 1 },
      { type: "assistant/reasoning-chunk", text: "will-read" },
      { type: "assistant/chunk", text: "note" },
      {
        type: "step/stats",
        turnId: "t1",
        step: 1,
        llmMs: 800,
        ttftMs: 120,
        decodeMs: 500,
        inputTokens: 10,
        outputTokens: 4,
        cacheReadTokens: 0,
      },
      { type: "tool/call", callId: "c1", name: "fs", args: { action: "read", path: "a.txt" } },
      { type: "tool/result", callId: "c1", name: "fs", text: "file-body", durationMs: 40 },
    ];
    const rows = buildTrajectoryFromEvents(events);
    expect(rows.map((r) => r.kind)).toEqual(["assistant", "tool"]);
    expect(rows[0]?.thinking).toBe("will-read");
    expect(rows[0]?.output).toBe("note");
    expect(rows[0]?.timing?.llmMs).toBe(800);
    expect(rows[0]?.timing?.ttftMs).toBe(120);
    expect(rows[1]?.id).toBe("tool:c1");
    expect(rows[1]?.result).toBe("file-body");
    expect(rows[1]?.toolState).toBe("done");
    expect(rows[1]?.timing?.durationMs).toBe(40);
    expect(rows[1]?.preview).toContain("File");
    expect(rows[1]?.preview).toContain("file-body");
  });

  it("does not truncate tool results and marks errors", () => {
    const text = `ok-${"x".repeat(2100)}`;
    const rows = buildTrajectoryFromEvents([
      { type: "tool/call", callId: "c1", name: "fs", args: {} },
      { type: "tool/result", callId: "c1", name: "fs", text },
    ]);
    expect(rows[0]?.result).toBe(text);
    expect(rows[0]?.result?.length).toBe(text.length);

    const failed = buildTrajectoryFromEvents([
      { type: "tool/call", callId: "c2", name: "fs", args: {} },
      { type: "tool/result", callId: "c2", name: "fs", text: "failed: bad" },
    ]);
    expect(failed[0]?.toolState).toBe("error");
  });

  it("marks in-flight assistant and tool as running", () => {
    const live = buildTrajectoryFromEvents([
      { type: "turn/start", turnId: "t1", startedAt: 1 },
      { type: "step/start", turnId: "t1", step: 1 },
      { type: "assistant/reasoning-chunk", text: "..." },
    ]);
    expect(live).toHaveLength(1);
    expect(live[0]?.kind).toBe("assistant");
    expect(live[0]?.running).toBe(true);

    const tool = buildTrajectoryFromEvents([
      { type: "tool/call", callId: "c1", name: "shell", args: { command: "ls" } },
    ]);
    expect(tool[0]?.toolState).toBe("running");
    expect(tool[0]?.running).toBe(true);
  });

  it("skips empty ok steward and ignores end/turn-stats", () => {
    const rows = buildTrajectoryFromEvents([
      { type: "user/message", text: "go" },
      { type: "guard/steward", callId: "c1", tool: "fs", verdict: "ok", summary: "" },
      { type: "guard/steward", callId: "c2", tool: "fs", verdict: "suspicious", summary: "look" },
      { type: "turn/stats", turnId: "t1", steps: 1, toolCalls: 0, durationMs: 1, guard: { allow: 0, deny: 0, ask: 0, suspicious: 0 } },
      { type: "end", status: "ok" },
    ]);
    expect(rows.map((r) => r.kind)).toEqual(["user", "guard"]);
    expect(rows[1]?.guardLabel).toContain("suspicious");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run apps/desktop/tests/trajectoryRecords.test.ts`

Expected: FAIL（模块不存在或 `buildTrajectoryFromEvents` 未定义）

- [ ] **Step 3: 实现折叠函数**

`apps/desktop/src/trajectoryRecords.ts`：

```ts
import type { WorkbenchEvent } from "./types.ts";
import {
  toolDisplaySummary,
  toolDisplayTitle,
  toolResultState,
} from "./toolDisplay.ts";

export type TrajectoryKind =
  | "user"
  | "assistant"
  | "tool"
  | "error"
  | "guard"
  | "a2ui";

export type TrajectoryTiming = {
  llmMs?: number;
  ttftMs?: number;
  decodeMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  durationMs?: number;
};

export type TrajectoryRecord = {
  id: string;
  kind: TrajectoryKind;
  turn: number;
  turnId?: string;
  step?: number;
  preview: string;
  running?: boolean;
  turnStart?: boolean;
  thinking?: string;
  output?: string;
  args?: unknown;
  result?: string;
  callId?: string;
  toolName?: string;
  toolState?: "running" | "done" | "error";
  errorKind?: string;
  errorMessage?: string;
  guardTool?: string;
  guardLabel?: string;
  surfaceId?: string;
  a2uiWait?: boolean;
  timing?: TrajectoryTiming;
};

export function previewLine(text: string, max = 160): string {
  const line = text.split("\n", 1)[0] ?? "";
  const trimmed = line.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}

function assistantPreview(thinking: string, output: string, running: boolean): string {
  if (output.length > 0) return previewLine(output);
  if (running && thinking.length > 0) return "思考中";
  return previewLine(thinking);
}

function toolPreview(name: string, args: unknown, result: string | undefined): string {
  const head = `${toolDisplayTitle(name)} · ${toolDisplaySummary(name, args)}`;
  if (result === undefined || result.length === 0) return head;
  return `${head} → ${previewLine(result, 80)}`;
}

export function buildTrajectoryFromEvents(events: WorkbenchEvent[]): TrajectoryRecord[] {
  const records: TrajectoryRecord[] = [];
  let turn = 0;
  let turnId: string | undefined;
  let step: number | undefined;
  let reasoningBuf = "";
  let outputBuf = "";
  let pendingTiming: TrajectoryTiming | undefined;
  let seq = 0;
  const toolAt = new Map<string, number>();
  const seenTurnStart = new Set<number>();

  const markTurnStart = (row: TrajectoryRecord): void => {
    if (!seenTurnStart.has(row.turn)) {
      row.turnStart = true;
      seenTurnStart.add(row.turn);
    }
  };

  const flushAssistant = (running: boolean): void => {
    if (reasoningBuf.length === 0 && outputBuf.length === 0 && pendingTiming === undefined) {
      return;
    }
    const id = `assistant:${turnId ?? "none"}:${step ?? 0}`;
    const existing = records.findIndex((row) => row.id === id);
    const row: TrajectoryRecord = {
      id,
      kind: "assistant",
      turn: turn === 0 ? 1 : turn,
      turnId,
      step,
      preview: assistantPreview(reasoningBuf, outputBuf, running),
      thinking: reasoningBuf.length > 0 ? reasoningBuf : undefined,
      output: outputBuf.length > 0 ? outputBuf : undefined,
      timing: pendingTiming,
      running: running || undefined,
    };
    markTurnStart(row);
    if (existing >= 0) {
      records[existing] = { ...records[existing], ...row, turnStart: records[existing]?.turnStart };
    } else {
      records.push(row);
    }
    reasoningBuf = "";
    outputBuf = "";
    pendingTiming = undefined;
  };

  for (const event of events) {
    switch (event.type) {
      case "turn/start":
        flushAssistant(false);
        turn += 1;
        turnId = event.turnId;
        step = undefined;
        break;
      case "step/start":
        flushAssistant(false);
        turnId = event.turnId;
        step = event.step;
        if (turn === 0) turn = 1;
        break;
      case "assistant/reasoning-chunk":
        reasoningBuf += event.text;
        break;
      case "assistant/chunk":
        outputBuf += event.text;
        break;
      case "assistant/message":
        outputBuf = event.text;
        flushAssistant(false);
        break;
      case "step/stats": {
        const stats: TrajectoryTiming = {
          llmMs: event.llmMs,
          ttftMs: event.ttftMs,
          decodeMs: event.decodeMs,
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          cacheReadTokens: event.cacheReadTokens,
        };
        pendingTiming = stats;
        const id = `assistant:${event.turnId}:${event.step}`;
        const existing = records.find((row) => row.id === id);
        if (existing) existing.timing = { ...existing.timing, ...stats };
        break;
      }
      case "tool/call": {
        flushAssistant(false);
        const row: TrajectoryRecord = {
          id: `tool:${event.callId}`,
          kind: "tool",
          turn: turn === 0 ? 1 : turn,
          turnId,
          step,
          preview: toolPreview(event.name, event.args, undefined),
          callId: event.callId,
          toolName: event.name,
          args: event.args,
          toolState: "running",
          running: true,
        };
        markTurnStart(row);
        toolAt.set(event.callId, records.length);
        records.push(row);
        break;
      }
      case "tool/result": {
        const idx = toolAt.get(event.callId);
        const state = toolResultState(event.text);
        const timing = event.durationMs !== undefined ? { durationMs: event.durationMs } : undefined;
        if (idx !== undefined) {
          const prev = records[idx];
          if (prev?.kind === "tool") {
            records[idx] = {
              ...prev,
              result: event.text,
              toolState: state,
              running: undefined,
              preview: toolPreview(prev.toolName ?? event.name, prev.args, event.text),
              timing: { ...prev.timing, ...timing },
            };
          }
        } else {
          const row: TrajectoryRecord = {
            id: `tool:${event.callId}`,
            kind: "tool",
            turn: turn === 0 ? 1 : turn,
            turnId,
            step,
            preview: toolPreview(event.name, {}, event.text),
            callId: event.callId,
            toolName: event.name,
            args: {},
            result: event.text,
            toolState: state,
            timing,
          };
          markTurnStart(row);
          records.push(row);
        }
        break;
      }
      case "user/message": {
        flushAssistant(false);
        if (turn === 0) turn = 1;
        const row: TrajectoryRecord = {
          id: `user:${turnId ?? `u${seq++}`}`,
          kind: "user",
          turn,
          turnId,
          preview: previewLine(event.text),
          output: event.text,
        };
        markTurnStart(row);
        records.push(row);
        break;
      }
      case "model/error": {
        flushAssistant(false);
        const row: TrajectoryRecord = {
          id: `error:${seq++}`,
          kind: "error",
          turn: turn === 0 ? 1 : turn,
          turnId,
          preview: previewLine(event.message),
          errorKind: event.kind,
          errorMessage: event.message,
        };
        markTurnStart(row);
        records.push(row);
        break;
      }
      case "guard/ask": {
        flushAssistant(false);
        const row: TrajectoryRecord = {
          id: `guard:${event.callId}`,
          kind: "guard",
          turn: turn === 0 ? 1 : turn,
          turnId: event.turnId,
          preview: `ask · ${event.tool}`,
          callId: event.callId,
          guardTool: event.tool,
          guardLabel: "ask",
        };
        markTurnStart(row);
        records.push(row);
        break;
      }
      case "guard/steward": {
        if (event.verdict === "ok" && event.summary.length === 0) break;
        flushAssistant(false);
        const row: TrajectoryRecord = {
          id: `guard-steward:${event.callId}:${seq++}`,
          kind: "guard",
          turn: turn === 0 ? 1 : turn,
          turnId,
          preview: previewLine(event.summary) || event.verdict,
          callId: event.callId,
          guardTool: event.tool,
          guardLabel: event.verdict,
        };
        markTurnStart(row);
        records.push(row);
        break;
      }
      case "a2ui/surface": {
        flushAssistant(false);
        const row: TrajectoryRecord = {
          id: `a2ui:${event.surfaceId}:${seq++}`,
          kind: "a2ui",
          turn: turn === 0 ? 1 : turn,
          turnId: event.turnId,
          preview: event.wait ? `A2UI wait · ${event.surfaceId}` : `A2UI · ${event.surfaceId}`,
          surfaceId: event.surfaceId,
          a2uiWait: event.wait,
        };
        markTurnStart(row);
        records.push(row);
        break;
      }
      case "turn/end":
        flushAssistant(false);
        break;
      default:
        break;
    }
  }
  flushAssistant(true);
  return records;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run apps/desktop/tests/trajectoryRecords.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**（用户未要求则跳过）

```powershell
git add apps/desktop/src/trajectoryRecords.ts apps/desktop/tests/trajectoryRecords.test.ts
git commit -m @"
feat(desktop): 从 session 事件投影 Trajectory 账本行

轨迹按 step 合并思考与正文，工具结果保留全文，供检查台使用而不改 Chat 气泡。
"@
```

---

### Task 2: 轨迹账本 + 详情组件

**Files:**
- Create: `apps/desktop/src/TrajectoryTable.tsx`
- Create: `apps/desktop/src/TrajectoryInspector.tsx`
- Create: `apps/desktop/src/TrajectoryView.tsx`
- Modify: `apps/desktop/src/app.css`（文件末尾追加 `.chat-view-tabs` 与 `.trajectory-*`）
- Create: `apps/desktop/tests/TrajectoryView.test.tsx`

**Interfaces:**
- Consumes: `TrajectoryRecord`、`previewLine`（Task 1）；`formatDuration`、`formatTokens`（`turnStats.ts`）；`formatToolArgs`（`toolDisplay.ts`）；`MessageFileCards`
- Produces: `TrajectoryView({ records, inspectCallId, onInspectDone, onOpenFile })`

- [ ] **Step 1: 写失败测试**

```tsx
/** @vitest-environment jsdom */

import { describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TrajectoryView } from "../src/TrajectoryView.tsx";
import type { TrajectoryRecord } from "../src/trajectoryRecords.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const records: TrajectoryRecord[] = [
  { id: "user:t1", kind: "user", turn: 1, turnStart: true, preview: "hi", output: "hi" },
  {
    id: "assistant:t1:1",
    kind: "assistant",
    turn: 1,
    step: 1,
    preview: "hello",
    thinking: "raw-thinking-full",
    output: "hello",
    timing: { llmMs: 800, ttftMs: 120 },
  },
  {
    id: "tool:c1",
    kind: "tool",
    turn: 1,
    step: 1,
    preview: "File · a.txt → body",
    callId: "c1",
    toolName: "fs",
    args: { action: "read", path: "a.txt" },
    result: "file-body",
    toolState: "done",
    timing: { durationMs: 40 },
  },
];

describe("TrajectoryView", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  function mount(node: ReactElement) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(node);
    });
  }

  function cleanup() {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = undefined;
    container = undefined;
  }

  it("selects a tool row and defaults inspector to Result", () => {
    mount(<TrajectoryView records={records} />);
    const tool = [...(container?.querySelectorAll("[data-trajectory-id]") ?? [])].find(
      (el) => el.getAttribute("data-trajectory-id") === "tool:c1",
    );
    act(() => {
      (tool as HTMLElement).click();
    });
    expect(container?.querySelector("[data-inspector-tab='result']")?.getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(container?.querySelector("[data-inspector-panel]")?.textContent).toContain("file-body");
    cleanup();
  });

  it("opens thinking tab by default for assistant with thinking", () => {
    mount(<TrajectoryView records={records} />);
    const assistant = [...(container?.querySelectorAll("[data-trajectory-id]") ?? [])].find(
      (el) => el.getAttribute("data-trajectory-id") === "assistant:t1:1",
    );
    act(() => {
      (assistant as HTMLElement).click();
    });
    expect(
      container?.querySelector("[data-inspector-tab='thinking']")?.getAttribute("aria-selected"),
    ).toBe("true");
    expect(container?.querySelector("[data-inspector-panel]")?.textContent).toContain(
      "raw-thinking-full",
    );
    cleanup();
  });

  it("scrolls to inspectCallId and selects the tool", () => {
    const onInspectDone = vi.fn();
    mount(
      <TrajectoryView records={records} inspectCallId="c1" onInspectDone={onInspectDone} />,
    );
    const tool = container?.querySelector('[data-trajectory-id="tool:c1"]');
    expect(tool?.getAttribute("aria-selected")).toBe("true");
    expect(container?.querySelector("[data-inspector-panel]")?.textContent).toContain("file-body");
    expect(onInspectDone).toHaveBeenCalled();
    cleanup();
  });

  it("shows empty copy when there are no records", () => {
    mount(<TrajectoryView records={[]} />);
    expect(container?.textContent).toContain("尚无轨迹");
    cleanup();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run apps/desktop/tests/TrajectoryView.test.tsx`

Expected: FAIL（`TrajectoryView` 未定义）

- [ ] **Step 3: 实现三个组件 + CSS**

`defaultInspectorTab` 放在 `TrajectoryInspector.tsx`：

- assistant：有 `thinking` → `"thinking"`，否则 `"output"`（无 output 则 `"summary"`）
- tool：有 `result` → `"result"`，否则 `"payload"`
- 其它 → `"summary"`

只渲染有内容的 tab：`thinking` 要字符串；`output` 要字符串；`payload` 要 `args`；`result` 要 `result`；`timing` 要 `timing` 里至少一项有值。

`TrajectoryTable.tsx`：`<table>` 两列；行 `data-trajectory-id={record.id}`、`aria-selected`；`turnStart` 时 Event 列加 `Turn {n}`；assistant/tool 加 `Step {n}`；`kind` 用 `data-role-kind`。点行 `onSelect(id)`。

`TrajectoryInspector.tsx`：无 `selected` 则 `return null`。有则 `<aside aria-label="事件详情">`，页签 `data-inspector-tab`，内容 `data-inspector-panel`。关闭按钮调用 `onClose`。TOOL Result 里用 `<pre>` + `MessageFileCards`。Timing 用 `formatDuration` / `formatTokens` 逐项列出存在的字段。

`TrajectoryView.tsx`：

```tsx
import { useEffect, useState } from "react";
import { TrajectoryInspector } from "./TrajectoryInspector.tsx";
import { TrajectoryTable } from "./TrajectoryTable.tsx";
import type { TrajectoryRecord } from "./trajectoryRecords.ts";

export type TrajectoryViewProps = {
  records: TrajectoryRecord[];
  inspectCallId?: string | null;
  onInspectDone?: () => void;
  onOpenFile?: (path: string) => void;
};

export function TrajectoryView({
  records,
  inspectCallId,
  onInspectDone,
  onOpenFile,
}: TrajectoryViewProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!inspectCallId) return;
    const id = `tool:${inspectCallId}`;
    if (records.some((row) => row.id === id)) {
      setSelectedId(id);
      document.querySelector(`[data-trajectory-id="${CSS.escape(id)}"]`)?.scrollIntoView({
        block: "nearest",
      });
    }
    onInspectDone?.();
  }, [inspectCallId, records, onInspectDone]);

  if (records.length === 0) {
    return (
      <div className="trajectory-root" data-conversation-composer-overlay="">
        <p className="trajectory-empty">尚无轨迹</p>
      </div>
    );
  }

  const selected = records.find((row) => row.id === selectedId);

  return (
    <div className="trajectory-root">
      <div className="trajectory-ledger">
        <TrajectoryTable
          records={records}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </div>
      {selected ? (
        <TrajectoryInspector
          record={selected}
          onClose={() => setSelectedId(null)}
          onOpenFile={onOpenFile}
        />
      ) : null}
    </div>
  );
}
```

`app.css` 末尾追加（用现有 CSS 变量，不要新依赖）：

```css
.chat-view-tabs {
  display: flex;
  gap: 2px;
  margin-right: var(--space-2);
}

.chat-view-tabs button {
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 0.8rem;
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
}

.chat-view-tabs button[aria-selected="true"] {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.trajectory-root {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

.trajectory-ledger {
  flex: 1;
  min-width: 0;
  overflow: auto;
}

.trajectory-empty {
  margin: auto;
  color: var(--text-tertiary);
}

.trajectory-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}

.trajectory-table tr[aria-selected="true"] {
  background: var(--bg-tertiary);
}

.trajectory-table td {
  padding: 6px 10px;
  border-bottom: 1px solid var(--border-subtle);
  vertical-align: top;
}

.trajectory-kind {
  white-space: nowrap;
  color: var(--text-secondary);
}

.trajectory-inspector {
  flex: 0 0 360px;
  width: 360px;
  border-left: 1px solid var(--border-subtle);
  overflow: auto;
  padding: var(--space-3);
}

.trajectory-inspector pre {
  white-space: pre-wrap;
  word-break: break-word;
}
```

`.log` 已是 `flex: 1`。轨迹根节点必须同样能在 `chat-column` 里吃掉剩余高度：给 `.chat-column` 里非 header/footer 的中间层保持 `flex: 1; min-height: 0`。若 `.log` 的 flex 规则不自动落到轨迹，给 `.trajectory-root` 加与 `.log` 相同的 flex 项。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run apps/desktop/tests/TrajectoryView.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**（用户未要求则跳过）

```powershell
git add apps/desktop/src/TrajectoryView.tsx apps/desktop/src/TrajectoryTable.tsx apps/desktop/src/TrajectoryInspector.tsx apps/desktop/src/app.css apps/desktop/tests/TrajectoryView.test.tsx
git commit -m @"
feat(desktop): 增加 Trajectory 账本与事件详情面板

检查台用两列账本和按行类型切换的详情，thinking 与 tool 结果以原文展示。
"@
```

---

### Task 3: App 选项卡、eventsRef、保活、rAF

**Files:**
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/tests/App.test.tsx`

**Interfaces:**
- Consumes: `buildTrajectoryFromEvents`、`TrajectoryView`
- Produces: `chatView: "chat" | "trajectory"`；`eventsRef: WorkbenchEvent[]`；轨迹仅在 `chatView === "trajectory"` 时挂载

- [ ] **Step 1: 写失败测试（插在 `App.test.tsx` 现有 `describe` 内）**

沿用文件里的 `mountApp` / `typeAndSend` / `waitForText` / `installFetch`。新增：

```tsx
  it("keeps chat as default and does not mount trajectory ledger", async () => {
    installFetch();
    await mountApp();
    await typeAndSend("typed locally");
    expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("对话");
    expect(document.querySelector(".trajectory-root")).toBeNull();
  });

  it("rebuilds trajectory from events without changing chat tool truncation", async () => {
    const result = "r".repeat(2001);
    const toolSse =
      `data: ${JSON.stringify({ type: "tool/call", callId: "c1", name: "fs", args: { path: "a.txt" } })}\n\n` +
      `data: ${JSON.stringify({ type: "tool/result", callId: "c1", name: "fs", text: result })}\n\n` +
      `data: ${JSON.stringify({ type: "end", status: "ok" })}\n\n`;
    installFetch({
      turn: new Response(toolSse, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    });
    await mountApp();
    await typeAndSend("use tool");
    await waitForText("File");
    expect(document.querySelector(".trajectory-root")).toBeNull();
    expect(document.body.textContent).not.toContain(result);

    const trajTab = [...document.querySelectorAll('[role="tab"]')].find((el) => el.textContent === "轨迹");
    await act(async () => {
      (trajTab as HTMLButtonElement).click();
    });
    await waitForText("尚无轨迹").catch(() => undefined);
    const panel = document.querySelector('[data-trajectory-id="tool:c1"]');
    expect(panel).toBeTruthy();
    await act(async () => {
      (panel as HTMLElement).click();
    });
    expect(document.querySelector("[data-inspector-panel]")?.textContent).toContain(result);
    expect(document.querySelector(".log")).toBeTruthy();
  });
```

第二个用例切到轨迹后 Chat `.log` 仍在 DOM（保活）。对话页时 body 不含 2001 字全文。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run apps/desktop/tests/App.test.tsx -t "keeps chat as default"`

Expected: FAIL（没有 tab）

- [ ] **Step 3: 接入 App**

在 `App` 内增加：

```ts
type ChatView = "chat" | "trajectory";
const [chatView, setChatView] = useState<ChatView>("chat");
const chatViewRef = useRef<ChatView>("chat");
const eventsRef = useRef<WorkbenchEvent[]>([]);
const [trajectoryRecords, setTrajectoryRecords] = useState<TrajectoryRecord[]>([]);
const trajRafRef = useRef<number>(0);

function applyChatView(next: ChatView) {
  chatViewRef.current = next;
  setChatView(next);
  if (next === "trajectory") {
    setTrajectoryRecords(buildTrajectoryFromEvents(eventsRef.current));
  }
}

function scheduleTrajectory() {
  if (chatViewRef.current !== "trajectory") return;
  if (trajRafRef.current !== 0) return;
  trajRafRef.current = requestAnimationFrame(() => {
    trajRafRef.current = 0;
    setTrajectoryRecords(buildTrajectoryFromEvents(eventsRef.current));
  });
}
```

`handleEvent` **第一件事**（所有 early return 之前）：

```ts
eventsRef.current = [...eventsRef.current, event];
scheduleTrajectory();
```

不要改后面的气泡分支。`user/message` 仍 `return`（气泡侧）；事件已经进 `eventsRef`。

`switchSession`：在 `setBubbles([])` 旁 `eventsRef.current = []`；`fetchSession` 成功后 `eventsRef.current = session.events`，若 `chatViewRef.current === "trajectory"` 则 `setTrajectoryRecords(buildTrajectoryFromEvents(session.events))`，否则不要为轨迹 `setState`。

`resetToNewSession`：`eventsRef.current = []`；`setTrajectoryRecords([])`。不清 `chatView`（保留选项卡）。

初始 `fetchSession`（`useEffect` 里现有那段）：同样写入 `eventsRef`。

`chat-header` 在标题和 status 之间插入：

```tsx
<div className="chat-view-tabs" role="tablist" aria-label="会话视图">
  <button type="button" role="tab" aria-selected={chatView === "chat"} onClick={() => applyChatView("chat")}>
    对话
  </button>
  <button type="button" role="tab" aria-selected={chatView === "trajectory"} onClick={() => applyChatView("trajectory")}>
    轨迹
  </button>
</div>
```

`.log`：加 `hidden={chatView !== "chat"}`，并用 ref 回调设置 `inert`：

```ts
function bindLogEl(el: HTMLElement | null) {
  logRef.current = el;
  if (el) el.inert = chatView !== "chat";
}
```

`main.log` 的 `ref` 换成 `bindLogEl`（`chatView` 变化时在 render 里同步 `logRef.current && (logRef.current.inert = chatView !== "chat")`）。

`.log` 后面：

```tsx
{chatView === "trajectory" ? (
  <TrajectoryView records={trajectoryRecords} onOpenFile={openFileFromChat} />
) : null}
```

本 Task **先不传** `inspectCallId`（Task 4）。

卸载：`useEffect` cleanup `cancelAnimationFrame(trajRafRef.current)`。

- [ ] **Step 4: 跑相关 App 测试**

Run:

```
pnpm exec vitest run apps/desktop/tests/App.test.tsx -t "keeps chat as default|rebuilds trajectory|truncated result|groups consecutive tool|already-emitted-order-probe"
```

Expected: 全部 PASS。截断用例仍绿（对话页未挂载轨迹）。思考顺序用例仍绿（未改 bubble 路径）。

- [ ] **Step 5: Commit**（用户未要求则跳过）

```powershell
git add apps/desktop/src/App.tsx apps/desktop/tests/App.test.tsx
git commit -m @"
feat(desktop): 对话页加入轨迹选项卡并旁路缓冲事件

Chat 气泡路径不变；仅轨迹可见时从 eventsRef 重建账本，避免思考流式卡顿。
"@
```

---

### Task 4: 工具行跳转到轨迹

**Files:**
- Modify: `apps/desktop/src/ToolCallRow.tsx`
- Modify: `apps/desktop/tests/ToolCallRow.test.tsx`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/tests/App.test.tsx`

**Interfaces:**
- Consumes: `TrajectoryView.inspectCallId` / `onInspectDone`（Task 2）
- Produces: `ToolCallRow` 新增可选 `callId?: string`、`onInspect?: (callId: string) => void`

- [ ] **Step 1: 写失败测试**

`ToolCallRow.test.tsx` 追加：

```tsx
  it("inspect button does not toggle IN/OUT", () => {
    const onInspect = vi.fn();
    mount(
      <ToolCallRow
        name="fs"
        callId="c1"
        args={{ path: "a.txt" }}
        result="hello"
        state="done"
        onInspect={onInspect}
      />,
    );
    expect(container?.querySelector(".tool-io-section")).toBeNull();
    const inspect = container?.querySelector('[aria-label="在轨迹中查看"]') as HTMLButtonElement;
    act(() => {
      inspect.click();
    });
    expect(onInspect).toHaveBeenCalledWith("c1");
    expect(container?.querySelector(".tool-io-section")).toBeNull();
    act(() => {
      container?.querySelector(".disclosure-row-header")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(container?.querySelector(".tool-io-section")).toBeTruthy();
  });
```

测试文件顶部把 `vi` 加入 vitest import。

`App.test.tsx` 追加：

```tsx
  it("jumps from a tool row inspect button to the trajectory record", async () => {
    const toolSse =
      `data: ${JSON.stringify({ type: "tool/call", callId: "c1", name: "fs", args: { path: "a.txt" } })}\n\n` +
      `data: ${JSON.stringify({ type: "tool/result", callId: "c1", name: "fs", text: "hello-out" })}\n\n` +
      `data: ${JSON.stringify({ type: "end", status: "ok" })}\n\n`;
    installFetch({
      turn: new Response(toolSse, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    });
    await mountApp();
    await typeAndSend("use tool");
    await waitForText("File");
    const inspect = document.querySelector('[aria-label="在轨迹中查看"]') as HTMLButtonElement;
    await act(async () => {
      inspect.click();
    });
    expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("轨迹");
    const row = document.querySelector('[data-trajectory-id="tool:c1"]');
    expect(row?.getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector("[data-inspector-panel]")?.textContent).toContain("hello-out");
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run apps/desktop/tests/ToolCallRow.test.tsx apps/desktop/tests/App.test.tsx -t "inspect"`

Expected: FAIL（无 inspect 按钮）

- [ ] **Step 3: 实现**

`ToolCallRow`：`callId` / `onInspect` 可选。在 `disclosure-row` 内、header **旁边**放：

```tsx
{onInspect && callId ? (
  <button
    type="button"
    className="tool-inspect-btn"
    aria-label="在轨迹中查看"
    onClick={(event) => {
      event.stopPropagation();
      onInspect(callId);
    }}
  >
    轨迹
  </button>
) : null}
```

**不要**把该按钮放进 `.disclosure-row-header` 里却不 `stopPropagation`——header 是展开按钮，嵌套 button 非法。结构改为：

```tsx
<div className="disclosure-row tool-row ...">
  <div className="disclosure-row-bar">
    <button type="button" className="disclosure-row-header" ...>...</button>
    {inspect button}
  </div>
  {expanded body}
</div>
```

`.disclosure-row-bar` 用 flex，header `flex: 1`。现有「点 header 展开」测试走 `.disclosure-row-header`，不受影响。

`app.css` 给 `.disclosure-row-bar` / `.tool-inspect-btn` 最小样式（透明背景、小字、不抢 `.disclosure-row-header` 点击）。

`App.tsx`：

```ts
const [inspectCallId, setInspectCallId] = useState<string | null>(null);

function inspectTool(callId: string) {
  setInspectCallId(callId);
  applyChatView("trajectory");
}
```

`ToolCallRow` 传入 `callId={bubble.callId}` `onInspect={inspectTool}`。

`TrajectoryView`：

```tsx
inspectCallId={inspectCallId}
onInspectDone={() => setInspectCallId(null)}
```

`resetToNewSession` / `switchSession`：`setInspectCallId(null)`。

- [ ] **Step 4: 跑测试确认通过**

Run:

```
pnpm exec vitest run apps/desktop/tests/ToolCallRow.test.tsx apps/desktop/tests/App.test.tsx -t "inspect|truncated result|keeps OUT label"
```

Expected: PASS（header 展开仍有效，截断用例仍绿）

- [ ] **Step 5: Commit**（用户未要求则跳过）

```powershell
git add apps/desktop/src/ToolCallRow.tsx apps/desktop/src/App.tsx apps/desktop/src/app.css apps/desktop/tests/ToolCallRow.test.tsx apps/desktop/tests/App.test.tsx
git commit -m @"
feat(desktop): 从工具行跳转到对应轨迹记录

独立按钮不占用 IN/OUT 展开，按 callId 打开轨迹详情。
"@
```

---

### Task 5: Guard / A2UI 切回对话 + 回归

**Files:**
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/tests/App.test.tsx`

**Interfaces:**
- Consumes: 现有 `GUARD_SSE` / `SURFACE_SSE` 夹具
- Produces: `handleEvent` 在 `guard/ask` 与 `a2ui/surface.wait` 时同步 `chatViewRef` 并 `setChatView("chat")`

- [ ] **Step 1: 写失败测试**

```tsx
  it("switches back to chat when guard ask arrives on trajectory", async () => {
    installFetch({
      turn: new Response(GUARD_SSE, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    });
    await mountApp();
    const trajTab = [...document.querySelectorAll('[role="tab"]')].find((el) => el.textContent === "轨迹");
    await act(async () => {
      (trajTab as HTMLButtonElement).click();
    });
    expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("轨迹");
    await typeAndSend("run tool");
    await waitForText("允许执行工具");
    expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("对话");
    expect(document.querySelector(".log")?.hasAttribute("hidden")).toBe(false);
  });

  it("switches back to chat when a2ui wait surface arrives on trajectory", async () => {
    installFetch({
      turn: new Response(SURFACE_SSE, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    });
    await mountApp();
    const trajTab = [...document.querySelectorAll('[role="tab"]')].find((el) => el.textContent === "轨迹");
    await act(async () => {
      (trajTab as HTMLButtonElement).click();
    });
    await typeAndSend("confirm");
    await waitForText("Continue?");
    expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("对话");
  });
```

「允许执行工具」和 A2UI「Continue?」只出现在 Chat 气泡里，轨迹预览是 `ask · touch` / `A2UI wait · main`，用来确认已经切回对话。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run apps/desktop/tests/App.test.tsx -t "switches back to chat"`

Expected: FAIL（仍停在轨迹）若 Task 3 已能切轨迹。

- [ ] **Step 3: 实现切回**

`handleEvent` 在 `eventsRef` 追加之后、气泡分支之前：

```ts
    if (event.type === "guard/ask" || (event.type === "a2ui/surface" && event.wait)) {
      chatViewRef.current = "chat";
      setChatView("chat");
    }
    scheduleTrajectory();
```

`scheduleTrajectory` 见 Task 3：若此时已是 `chat` 则不再 rAF。顺序必须是先改 `chatViewRef` 再 `scheduleTrajectory`。

- [ ] **Step 4: 跑桌面相关测试**

Run:

```
pnpm exec vitest run apps/desktop/tests/trajectoryRecords.test.ts apps/desktop/tests/TrajectoryView.test.tsx apps/desktop/tests/ToolCallRow.test.tsx apps/desktop/tests/App.test.tsx
```

Expected: PASS。重点回归：`shows tool call row with truncated result`、`groups consecutive tool steps`、`already-emitted-order-probe` 思考顺序。

- [ ] **Step 5: Commit**（用户未要求则跳过）

```powershell
git add apps/desktop/src/App.tsx apps/desktop/tests/App.test.tsx
git commit -m @"
fix(desktop): 轨迹页遇到 guard 或 A2UI 等待时切回对话

允许/拒绝和等待表单仍在 Chat 气泡里，避免检查台挡住操作。
"@
```

---

## Spec coverage

| Spec 条款 | Task |
|---|---|
| 事件投影、ASSISTANT 含 chunk、全文 result、running | 1 |
| 账本 + 详情页签 + inspectCallId | 2 |
| 选项卡、eventsRef、rAF、不对称保活、默认对话 | 3 |
| 工具行独立跳转 | 4 |
| guard/ask、a2ui wait 切回 | 5 |
| 不改 ReasoningRow / chatBubbles / 截断语义 | 全程约束；Task 3/4 回归测试 |
| 不做时间轴/搜索/虚拟列表 | 无对应 Task |

## 实现时注意

- 现有 `App.test.tsx` 用 `.log > .message-tool-step`。`.log` 必须始终在 DOM 中（轨迹页只 `hidden`，不卸载）。
- 对话页不得挂载 `.trajectory-root`，否则 `not.toContain(result)` 会因详情/预览全文失败。
- `inert` 在 React 18 的类型里可能不存在：写 `el.inert = ...`，不要靠 JSX 属性。
- Task 4 改 `ToolCallRow` 结构后，`.tool-row .disclosure-row-header` 选择器仍要能点到展开按钮。
