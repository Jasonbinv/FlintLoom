/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import { extractFilePaths, fileBaseName, keepExistingFilePaths } from "../src/chatFilePaths.ts";

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

  it("keeps only paths that exist as files in listed directories", async () => {
    const existing = await keepExistingFilePaths(
      ["README.md", "version1.docx", "docs/plan.md", "docs/missing.md"],
      async (dir) => {
        if (dir === ".") {
          return {
            path: ".",
            entries: [
              { name: "README.md", type: "file" },
              { name: "docs", type: "dir" },
            ],
          };
        }
        if (dir === "docs") {
          return {
            path: "docs",
            entries: [{ name: "plan.md", type: "file" }],
          };
        }
        throw new Error("missing");
      },
    );
    expect(existing).toEqual(["README.md", "docs/plan.md"]);
  });

  it("resolves a bare filename to a unique file under ai_generation", async () => {
    const existing = await keepExistingFilePaths(
      ["shuihu.md", "missing.pptx"],
      async (dir) => {
        if (dir === ".") {
          return {
            path: ".",
            entries: [{ name: "ai_generation", type: "dir" }],
          };
        }
        if (dir === "ai_generation") {
          return {
            path: "ai_generation",
            entries: [{ name: "2026-08-30_水浒故事", type: "dir" }],
          };
        }
        if (dir === "ai_generation/2026-08-30_水浒故事") {
          return {
            path: "ai_generation/2026-08-30_水浒故事",
            entries: [
              { name: "shuihu.md", type: "file" },
              { name: "shuihu.pptx", type: "file" },
            ],
          };
        }
        throw new Error(`unexpected dir ${dir}`);
      },
    );
    expect(existing).toEqual(["ai_generation/2026-08-30_水浒故事/shuihu.md"]);
  });
});
