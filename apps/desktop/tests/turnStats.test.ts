import { describe, expect, it } from "vitest";
import {
  aggregateSessionStats,
  formatDuration,
  formatGuardSummary,
} from "../src/turnStats.ts";

describe("turnStats", () => {
  it("formats duration", () => {
    expect(formatDuration(1500)).toBe("1.5s");
    expect(formatDuration(65000)).toBe("1m5s");
  });

  it("formats guard summary", () => {
    expect(formatGuardSummary({ allow: 2, deny: 1, ask: 0, suspicious: 0 })).toBe(
      "guard: allow 2 · deny 1",
    );
    expect(formatGuardSummary({ allow: 0, deny: 0, ask: 0, suspicious: 0 })).toBeUndefined();
  });

  it("aggregates session stats", () => {
    const agg = aggregateSessionStats([
      {
        turnId: "t1",
        steps: 2,
        toolCalls: 1,
        durationMs: 1000,
        guard: { allow: 1, deny: 0, ask: 0, suspicious: 0 },
      },
      {
        turnId: "t2",
        steps: 1,
        toolCalls: 0,
        durationMs: 500,
        guard: { allow: 0, deny: 0, ask: 1, suspicious: 0 },
      },
    ]);
    expect(agg.turns).toBe(2);
    expect(agg.steps).toBe(3);
    expect(agg.durationMs).toBe(1500);
    expect(agg.toolCalls).toBe(1);
    expect(agg.guard.allow).toBe(1);
    expect(agg.guard.ask).toBe(1);
  });
});
