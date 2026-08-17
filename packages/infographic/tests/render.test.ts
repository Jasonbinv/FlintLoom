import { describe, expect, it } from "vitest";
import { renderSvg } from "../src/render.ts";

describe("renderSvg", () => {
  it("emits escaped labels and no href or script", () => {
    const svg = renderSvg({
      nodes: [{ id: "a", label: "A&B", x: 0, y: 0 }],
      edges: [],
    });
    expect(svg).toContain("<svg");
    expect(svg).toContain("A&amp;B");
    expect(svg).not.toContain("A&B");
    expect(svg).not.toMatch(/href/i);
    expect(svg).not.toContain("<script");
    expect(svg).toContain("#e8e8e8");
  });
});
