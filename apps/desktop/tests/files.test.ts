import { describe, expect, it } from "vitest";
import { isImageFilePath } from "../src/files.ts";

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
