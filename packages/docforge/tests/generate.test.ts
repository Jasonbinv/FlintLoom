import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "../src/parse.ts";
import {
  buildDocument,
  copyMarkdown,
  formatFromOutRelPath,
  generateDocument,
} from "../src/generate.ts";

const helloMd = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "fixtures/hello.md"),
  "utf8",
);

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

it("pdf and docx round-trip Hello and 发展 through parse", async () => {
  const dir = mkdtempSync(join(tmpdir(), "flintloom-gen-"));
  const source = join(dir, "hello.md");
  writeFileSync(source, helloMd);
  const pdfPath = join(dir, "hello.pdf");
  const docxPath = join(dir, "hello.docx");
  await generateDocument(source, pdfPath);
  await generateDocument(source, docxPath);
  expect(await parse(pdfPath)).toContain("Hello");
  expect(await parse(pdfPath)).toContain("发展");
  expect(await parse(docxPath)).toContain("Hello");
  expect(await parse(docxPath)).toContain("发展");
});

it("missing fontPath is unreadable and leaves out unchanged", async () => {
  await expect(
    buildDocument("pdf", "# Hello", { fontPath: join(tmpdir(), "no-such-font.otf") }),
  ).rejects.toThrow(/unreadable/);
  const dir = mkdtempSync(join(tmpdir(), "flintloom-gen-old-"));
  const out = join(dir, "old.pdf");
  writeFileSync(out, "OLD");
  await expect(generateDocument(dir, out)).rejects.toThrow(/unreadable/);
  expect(readFileSync(out, "utf8")).toBe("OLD");
});

it("rejects non-md source and huge files before parsing as utf8", async () => {
  const dir = mkdtempSync(join(tmpdir(), "flintloom-gen-bad-"));
  const docx = join(dir, "x.docx");
  writeFileSync(docx, "not-md");
  await expect(generateDocument(docx, join(dir, "x.pdf"))).rejects.toThrow(/bad source/);
  const huge = join(dir, "huge.md");
  writeFileSync(huge, Buffer.alloc(800_001, 0x61));
  await expect(generateDocument(huge, join(dir, "huge.pdf"))).rejects.toThrow(/too large/);
});
