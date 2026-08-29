import { describe, expect, it } from "vitest";
import { foldLoopingReasoning } from "../src/foldLoopingReasoning.ts";

describe("foldLoopingReasoning", () => {
  it("keeps short unique reasoning unchanged", () => {
    const text = "The user wants a heatmap.\n\nI will emit Chart kind heatmap.";
    expect(foldLoopingReasoning(text)).toBe(text);
  });

  it("drops repeated plan blocks from a rumination loop", () => {
    const block =
      "Final plan: use DataTable with headers 时段 and weekday columns, then explain the matrix view to the user.";
    const text = Array.from({ length: 12 }, () => block).join("\n\n");
    const folded = foldLoopingReasoning(text);
    const occurrences = folded.split(block).length - 1;
    expect(occurrences).toBeLessThanOrEqual(2);
    expect(folded).toMatch(/已折叠/);
  });

  it("caps extremely long reasoning even without duplicate blocks", () => {
    const text = "alpha ".repeat(5000);
    const folded = foldLoopingReasoning(text);
    expect(folded.length).toBeLessThan(text.length);
    expect(folded).toMatch(/已截断/);
  });
});
