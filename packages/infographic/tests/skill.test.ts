import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const skill = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../skills/antv-infographic/SKILL.md"),
  "utf8",
);

describe("antv-infographic skill", () => {
  it("routes SWOT, relation, and chart families to official templates and a2ui_emit", () => {
    expect(skill).toMatch(/Use when/i);
    expect(skill).toContain("compare-swot");
    expect(skill).toMatch(/SWOT[\s\S]*children/);
    expect(skill).not.toMatch(/optional `children`/);
    expect(skill).toContain("relation-dagre-flow-tb-simple-circle-node");
    expect(skill).toContain("chart-line-plain-text");
    expect(skill).toContain("a2ui_emit");
    expect(skill).toContain("nodes");
    expect(skill).toContain("values");
    expect(skill).not.toMatch(/Cannot auto-draw from invented prose/);
    expect(skill).not.toContain("unpkg.com");
    expect(skill).not.toMatch(/SWOT four-quadrant/);
  });

  it("keeps chat output on syntax emit instead of HTML or box-line JSON", () => {
    expect(skill).toContain("syntax");
    expect(skill).toContain("infographic.json");
    expect(skill).not.toMatch(/Write 工具生成 HTML/);
  });
});
