import { describe, expect, it } from "vitest";
import {
  aggregateSessionStats,
  cacheHitPercent,
  formatDuration,
  formatGuardSummary,
  formatTokens,
  formatTokensPerSecond,
} from "../src/turnStats.ts";

describe("turnStats", () => {
  it("formats duration", () => {
    expect(formatDuration(1500)).toBe("1.5s");
    expect(formatDuration(65000)).toBe("1m5s");
  });

  it("formats tokens and throughput", () => {
    expect(formatTokens(517)).toBe("517");
    expect(formatTokens(12_200)).toBe("12.2K");
    expect(formatTokensPerSecond(3.14)).toBe("3.1");
    expect(formatTokensPerSecond(24.6)).toBe("25");
    expect(cacheHitPercent(90, 100)).toBe("90");
    expect(cacheHitPercent(0, 100)).toBeUndefined();
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
        llmMs: 800,
        toolMs: 200,
        ttftMs: 400,
        ttftSteps: 1,
        decodeMs: 400,
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 40,
        guard: { allow: 1, deny: 0, ask: 0, suspicious: 0 },
      },
      {
        turnId: "t2",
        steps: 1,
        toolCalls: 0,
        durationMs: 500,
        llmMs: 500,
        toolMs: 0,
        ttftMs: 200,
        ttftSteps: 1,
        decodeMs: 300,
        inputTokens: 50,
        outputTokens: 10,
        cacheReadTokens: 0,
        guard: { allow: 0, deny: 0, ask: 1, suspicious: 0 },
      },
    ]);
    expect(agg.turns).toBe(2);
    expect(agg.steps).toBe(3);
    expect(agg.durationMs).toBe(1500);
    expect(agg.toolCalls).toBe(1);
    expect(agg.guard.allow).toBe(1);
    expect(agg.guard.ask).toBe(1);
    expect(agg.llmMs).toBe(1300);
    expect(agg.toolMs).toBe(200);
    expect(agg.ttftSteps).toBe(2);
    expect(agg.inputTokens).toBe(150);
    expect(agg.outputTokens).toBe(30);
    expect(agg.cacheReadTokens).toBe(40);
  });
});
