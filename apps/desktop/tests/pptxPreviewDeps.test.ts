import { describe, expect, it } from "vitest";

describe("pptx preview deps", () => {
  it("resolves chart.js/auto, the optional peer pptxviewjs imports", async () => {
    const mod = await import("chart.js/auto");
    expect(mod).toBeTruthy();
  });
});
