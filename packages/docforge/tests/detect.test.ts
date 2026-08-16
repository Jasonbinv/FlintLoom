import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { detectType } from "../src/detect.ts";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("detectType", () => {
  it("prefers md extension over html magic", () => {
    const bytes = Buffer.from("<html><h1>Hello</h1></html>");
    expect(detectType(join(fixtures, "note.md"), bytes)).toBe("md");
  });

  it("detects pdf by magic when extension is missing", () => {
    const bytes = Buffer.from("%PDF-1.4\n");
    expect(detectType(join(fixtures, "noext"), bytes)).toBe("pdf");
  });

  it("marks .doc as unknown", () => {
    const bytes = Buffer.from("OLE");
    expect(detectType("legacy.doc", bytes)).toBe("unknown");
  });
});
