import { describe, expect, it } from "vitest";
import { chartSvg } from "../src/a2ui-chart.tsx";

describe("chartSvg", () => {
  it("renders bar chart with labels", () => {
    const svg = chartSvg(["A", "B"], [2, 5], "bar");
    expect(svg).toContain('class="a2ui-chart-svg"');
    expect(svg).toContain("<rect");
    expect(svg).toContain(">A</text>");
    expect(svg).toContain(">B</text>");
  });

  it("renders line chart with polyline", () => {
    const svg = chartSvg(["Q1", "Q2", "Q3"], [1, 3, 2], "line");
    expect(svg).toContain("<polyline");
    expect(svg).toContain("<circle");
    expect(svg).not.toContain("<rect");
  });

  it("escapes xml in chart labels", () => {
    const svg = chartSvg(["A&B"], [1], "bar");
    expect(svg).toContain("A&amp;B");
    expect(svg).not.toContain("A&B");
  });

  it("handles a single data point in line mode", () => {
    const svg = chartSvg(["only"], [4], "line");
    expect(svg).toContain("<polyline");
    expect(svg).toContain("<circle");
  });
});
