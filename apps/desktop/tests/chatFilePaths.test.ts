/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import { extractFilePaths, fileBaseName } from "../src/chatFilePaths.ts";

describe("chatFilePaths", () => {
  it("extracts backtick paths", () => {
    expect(extractFilePaths("已写入 `docs/plan.md` 请查看")).toEqual([
      "docs/plan.md",
    ]);
  });

  it("extracts bare paths with extensions", () => {
    expect(
      extractFilePaths("请打开 README.md 或 src/App.tsx 查看实现"),
    ).toEqual(["README.md", "src/App.tsx"]);
  });

  it("extracts infographic json paths", () => {
    expect(extractFilePaths("见 flow.infographic.json")).toEqual([
      "flow.infographic.json",
    ]);
  });

  it("ignores urls and parent traversal", () => {
    expect(
      extractFilePaths("见 https://x.com/a.md 与 ../secret.txt"),
    ).toEqual([]);
  });

  it("deduplicates repeated paths", () => {
    expect(extractFilePaths("`a.md` 和 a.md")).toEqual(["a.md"]);
  });

  it("returns basename", () => {
    expect(fileBaseName("docs/setup.md")).toBe("setup.md");
  });
});
