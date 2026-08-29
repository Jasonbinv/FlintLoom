import { describe, expect, it } from "vitest";
import { chartSvg, heatmapSvg } from "../src/a2ui-chart.tsx";

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

  it("renders pie slices and legend", () => {
    const svg = chartSvg(["Apple", "Banana"], [3, 1], "pie");
    expect(svg).toContain("<path");
    expect(svg).toContain(">Apple</text>");
    expect(svg).toContain(">Banana</text>");
    expect(svg).toContain('aria-label="pie chart"');
  });

  it("renders doughnut with an inner hole path", () => {
    const svg = chartSvg(["A", "B", "C"], [1, 2, 3], "doughnut");
    expect(svg).toContain("<path");
    expect(svg).toContain('aria-label="doughnut chart"');
  });

  it("renders area chart as a filled polygon", () => {
    const svg = chartSvg(["Q1", "Q2", "Q3"], [1, 3, 2], "area");
    expect(svg).toContain("<polygon");
    expect(svg).toContain("<polyline");
    expect(svg).toContain(">Q1</text>");
  });

  it("renders horizontal bars", () => {
    const svg = chartSvg(["East", "West"], [4, 8], "hbar");
    expect(svg).toContain("<rect");
    expect(svg).toContain(">East</text>");
    expect(svg).toContain(">West</text>");
    expect(svg).toContain('aria-label="hbar chart"');
  });

  it("renders scatter as points without a connecting line", () => {
    const svg = chartSvg(["A", "B", "C"], [1, 4, 2], "scatter");
    expect(svg).toContain("<circle");
    expect(svg).not.toContain("<polyline");
    expect(svg).not.toContain("<rect");
  });

  it("renders radar as a polygon with axis labels", () => {
    const svg = chartSvg(["Attack", "Defense", "Speed"], [80, 60, 90], "radar");
    expect(svg).toContain("<polygon");
    expect(svg).toContain(">Attack</text>");
    expect(svg).toContain(">Defense</text>");
    expect(svg).toContain(">Speed</text>");
    expect(svg).toContain('aria-label="radar chart"');
    expect(svg).not.toContain("<polyline");
  });

  it("renders heatmap cells and axis labels", () => {
    const svg = heatmapSvg(
      ["Mon", "Tue"],
      ["AM", "PM"],
      [
        [1, 2],
        [3, 4],
      ],
    );
    expect(svg).toContain("<rect");
    expect(svg).toContain(">Mon</text>");
    expect(svg).toContain(">Tue</text>");
    expect(svg).toContain(">AM</text>");
    expect(svg).toContain(">PM</text>");
    expect(svg).toContain('aria-label="heatmap chart"');
  });

  it("escapes xml in heatmap labels", () => {
    const svg = heatmapSvg(["A&B"], ["C<D"], [[1]]);
    expect(svg).toContain("A&amp;B");
    expect(svg).toContain("C&lt;D");
    expect(svg).not.toContain("A&B");
  });
});
