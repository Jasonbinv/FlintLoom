import { describe, expect, it } from "vitest";
import { buildBubblesFromEvents, statsFromEvents } from "../src/chatBubbles.ts";
import type { WorkbenchEvent } from "../src/types.ts";

describe("buildBubblesFromEvents", () => {
  let id = 0;
  const allocId = () => String(++id);

  it("pairs tool call and result into one tool-step bubble", () => {
    const events: WorkbenchEvent[] = [
      { type: "user/message", text: "hi" },
      { type: "tool/call", callId: "c1", name: "fs", args: { action: "read", path: "a.txt" } },
      { type: "tool/result", callId: "c1", name: "fs", text: "hello" },
      { type: "assistant/message", text: "done" },
    ];
    const bubbles = buildBubblesFromEvents(events, allocId);
    expect(bubbles.map((b) => b.kind)).toEqual(["user", "tool-step", "assistant"]);
    const tool = bubbles[1];
    expect(tool?.kind).toBe("tool-step");
    if (tool?.kind === "tool-step") {
      expect(tool.state).toBe("done");
      expect(tool.result).toBe("hello");
    }
  });

  it("folds reasoning chunks before assistant message", () => {
    const events: WorkbenchEvent[] = [
      { type: "assistant/reasoning-chunk", text: "step one\n" },
      { type: "assistant/reasoning-chunk", text: "step two" },
      { type: "assistant/message", text: "answer" },
    ];
    const bubbles = buildBubblesFromEvents(events, allocId);
    expect(bubbles).toHaveLength(2);
    expect(bubbles[0]?.kind).toBe("reasoning");
    if (bubbles[0]?.kind === "reasoning") {
      expect(bubbles[0].text).toBe("step one\nstep two");
    }
    expect(bubbles[1]?.kind).toBe("assistant");
  });

  it("marks failed tool results as error", () => {
    const events: WorkbenchEvent[] = [
      { type: "tool/call", callId: "c1", name: "fs", args: {} },
      { type: "tool/result", callId: "c1", name: "fs", text: "failed: bad path" },
    ];
    const bubbles = buildBubblesFromEvents(events, allocId);
    const tool = bubbles[0];
    expect(tool?.kind).toBe("tool-step");
    if (tool?.kind === "tool-step") {
      expect(tool.state).toBe("error");
    }
  });

  it("attaches step number to tool bubbles and emits turn footer on turn/end", () => {
    const events: WorkbenchEvent[] = [
      { type: "turn/start", turnId: "t1", startedAt: 1000 },
      { type: "step/start", turnId: "t1", step: 1 },
      { type: "tool/call", callId: "c1", name: "fs", args: { action: "read" } },
      { type: "tool/result", callId: "c1", name: "fs", text: "ok" },
      {
        type: "turn/stats",
        turnId: "t1",
        steps: 1,
        toolCalls: 1,
        durationMs: 2500,
        guard: { allow: 1, deny: 0, ask: 0, suspicious: 0 },
      },
      { type: "turn/end", turnId: "t1", status: "ok" },
    ];
    const bubbles = buildBubblesFromEvents(events, allocId);
    expect(bubbles.map((b) => b.kind)).toEqual(["tool-step", "turn-footer"]);
    const tool = bubbles[0];
    if (tool?.kind === "tool-step") {
      expect(tool.step).toBe(1);
    }
    const footer = bubbles[1];
    expect(footer?.kind).toBe("turn-footer");
    if (footer?.kind === "turn-footer") {
      expect(footer.stats.steps).toBe(1);
      expect(footer.stats.durationMs).toBe(2500);
      expect(footer.stats.status).toBe("ok");
    }
  });

  it("collects turn stats from session events", () => {
    const events: WorkbenchEvent[] = [
      {
        type: "turn/stats",
        turnId: "t1",
        steps: 2,
        toolCalls: 1,
        durationMs: 5000,
        guard: { allow: 0, deny: 1, ask: 0, suspicious: 0 },
      },
      { type: "turn/end", turnId: "t1", status: "failed" },
    ];
    const stats = statsFromEvents(events);
    expect(stats).toHaveLength(1);
    expect(stats[0]?.steps).toBe(2);
    expect(stats[0]?.status).toBe("failed");
    expect(stats[0]?.guard.deny).toBe(1);
  });
});
