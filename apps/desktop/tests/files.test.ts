import { describe, expect, it } from "vitest";
import { isImageFilePath, resolveTreeDropDestination } from "../src/files.ts";

describe("isImageFilePath", () => {
  it("recognizes png and jpeg paths", () => {
    expect(isImageFilePath("sales_chart.png")).toBe(true);
    expect(isImageFilePath("图片/chart.PNG")).toBe(true);
    expect(isImageFilePath("photo.jpg")).toBe(true);
  });

  it("rejects non-image paths", () => {
    expect(isImageFilePath("plot.py")).toBe(false);
    expect(isImageFilePath("notes.md")).toBe(false);
  });
});

describe("resolveTreeDropDestination", () => {
  it("moves a file into a hovered folder", () => {
    expect(
      resolveTreeDropDestination("README.md", false, "docs", true),
    ).toBe("docs");
  });

  it("moves a nested file onto the workspace root", () => {
    expect(
      resolveTreeDropDestination("docs/README.md", false, ".", true),
    ).toBe(".");
  });

  it("treats dropping onto a file as dropping into that file's folder", () => {
    expect(
      resolveTreeDropDestination("README.md", false, "docs/notes.md", false),
    ).toBe("docs");
  });

  it("rejects dropping a file onto its current folder", () => {
    expect(
      resolveTreeDropDestination("docs/README.md", false, "docs", true),
    ).toBeNull();
  });

  it("rejects dropping a file onto a sibling in the same folder", () => {
    expect(
      resolveTreeDropDestination("docs/a.md", false, "docs/b.md", false),
    ).toBeNull();
  });

  it("rejects dropping a folder onto itself or a descendant", () => {
    expect(resolveTreeDropDestination("docs", true, "docs", true)).toBeNull();
    expect(
      resolveTreeDropDestination("docs", true, "docs/inner", true),
    ).toBeNull();
  });

  it("moves a folder into another folder", () => {
    expect(resolveTreeDropDestination("docs", true, "md", true)).toBe("md");
  });
});
