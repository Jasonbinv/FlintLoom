import { describe, expect, it } from "vitest";
import {
  buildDocument,
  copyMarkdown,
  formatFromOutRelPath,
} from "../src/generate.ts";

describe("formatFromOutRelPath", () => {
  it("lowercases and rejects markdown htm", () => {
    expect(formatFromOutRelPath("A.PDF")).toBe("pdf");
    expect(formatFromOutRelPath("notes\\out.HTML")).toBe("html");
    expect(formatFromOutRelPath("a.markdown")).toBeUndefined();
    expect(formatFromOutRelPath("a.htm")).toBeUndefined();
    expect(formatFromOutRelPath("a.md")).toBe("md");
  });
});

describe("buildDocument md/html", () => {
  it("strips BOM and keeps image syntax for md", async () => {
    const buf = await buildDocument("md", "\uFEFF# Hello\n![skip](x.png)");
    const text = buf.toString("utf8");
    expect(text.startsWith("\uFEFF")).toBe(false);
    expect(text.endsWith("\n")).toBe(true);
    expect(text).toContain("![skip](x.png)");
  });

  it("renders html without img or script", async () => {
    const html = (
      await buildDocument("html", "# Hello\n\n发展 & x\n\n![skip](x.png)")
    ).toString("utf8");
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain("Hello");
    expect(html).toContain("发展");
    expect(html).toContain("&amp;");
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/<script/i);
  });
});

describe("copyMarkdown", () => {
  it("appends a trailing newline", () => {
    expect(copyMarkdown("a")).toBe("a\n");
    expect(copyMarkdown("a\n")).toBe("a\n");
  });
});
