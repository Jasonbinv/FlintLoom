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

  it("preserves thinking and timing when assistant/message updates after tool/call flush", () => {
    const events: WorkbenchEvent[] = [
      { type: "turn/start", turnId: "t1", startedAt: 1 },
      { type: "step/start", turnId: "t1", step: 1 },
      { type: "assistant/reasoning-chunk", text: "plan-read" },
      {
        type: "step/stats",
        turnId: "t1",
        step: 1,
        llmMs: 900,
        ttftMs: 100,
        decodeMs: 600,
        inputTokens: 12,
        outputTokens: 5,
        cacheReadTokens: 0,
      },
      { type: "tool/call", callId: "c1", name: "fs", args: { action: "read", path: "a.txt" } },
      { type: "tool/result", callId: "c1", name: "fs", text: "body", durationMs: 30 },
      { type: "assistant/message", text: "final" },
      { type: "turn/end", turnId: "t1", status: "ok" },
    ];
    const rows = buildTrajectoryFromEvents(events);
    const assistant = rows.find((r) => r.kind === "assistant");
    expect(assistant?.thinking).toBe("plan-read");
    expect(assistant?.output).toBe("final");
    expect(assistant?.timing?.llmMs).toBe(900);
    expect(assistant?.timing?.ttftMs).toBe(100);
  });

  it("attaches step/stats to flushed assistant without wiping thinking", () => {
    const events: WorkbenchEvent[] = [
      { type: "turn/start", turnId: "t1", startedAt: 1 },
      { type: "step/start", turnId: "t1", step: 1 },
      { type: "assistant/reasoning-chunk", text: "already-there" },
      { type: "assistant/message", text: "done" },
      {
        type: "step/stats",
        turnId: "t1",
        step: 1,
        llmMs: 500,
        ttftMs: 80,
        decodeMs: 300,
        inputTokens: 8,
        outputTokens: 3,
        cacheReadTokens: 0,
      },
      { type: "turn/end", turnId: "t1", status: "ok" },
    ];
    const rows = buildTrajectoryFromEvents(events);
    const assistant = rows.find((r) => r.kind === "assistant");
    expect(assistant?.thinking).toBe("already-there");
    expect(assistant?.output).toBe("done");
    expect(assistant?.timing?.llmMs).toBe(500);
  });

  it("isolates thinking and output across two assistant steps in one turn", () => {
    const events: WorkbenchEvent[] = [
      { type: "turn/start", turnId: "t1", startedAt: 1 },
      { type: "user/message", text: "go" },
      { type: "step/start", turnId: "t1", step: 1 },
      { type: "assistant/reasoning-chunk", text: "think-step-1" },
      { type: "assistant/message", text: "msg-step-1" },
      { type: "step/start", turnId: "t1", step: 2 },
      { type: "assistant/reasoning-chunk", text: "think-step-2" },
      { type: "assistant/chunk", text: "chunk-step-2" },
      { type: "tool/call", callId: "c1", name: "fs", args: { action: "read", path: "a.txt" } },
      { type: "tool/result", callId: "c1", name: "fs", text: "file-body" },
    ];
    const rows = buildTrajectoryFromEvents(events);
    expect(rows.map((r) => r.id)).toEqual([
      "user:t1",
      "assistant:t1:1",
      "assistant:t1:2",
      "tool:c1",
    ]);
    const step1 = rows.find((r) => r.id === "assistant:t1:1");
    const step2 = rows.find((r) => r.id === "assistant:t1:2");
    const tool = rows.find((r) => r.id === "tool:c1");
    expect(step1?.thinking).toBe("think-step-1");
    expect(step1?.output).toBe("msg-step-1");
    expect(step2?.thinking).toBe("think-step-2");
    expect(step2?.output).toBe("chunk-step-2");
    expect(step1?.thinking).not.toBe(step2?.thinking);
    expect(step1?.output).not.toBe(step2?.output);
    expect(tool?.kind).toBe("tool");
    expect(tool?.toolName).toBe("fs");
    expect(tool?.result).toBe("file-body");
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
