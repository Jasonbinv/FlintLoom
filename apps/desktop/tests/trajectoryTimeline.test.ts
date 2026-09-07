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
