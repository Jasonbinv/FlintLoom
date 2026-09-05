import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { parse } from "../src/parse.ts";
import { GENERATE_MAX_BYTES } from "../src/generate.ts";
import { convertDocument, lossForConvert } from "../src/convert.ts";
import { EMPTY_PDF, HELLO_PDF } from "./helpers/pdf.ts";
import { writeHelloDocx, writeHelloXlsx } from "./helpers/office.ts";

const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const helloMd = readFileSync(join(fixtures, "hello.md"), "utf8");

describe("lossForConvert", () => {
  it("uses source-type rows and md-to-md none", () => {
    expect(lossForConvert("md", "md")).toBe("none");
    expect(lossForConvert("md", "pdf")).toBe("images skipped; emphasis flattened");
    expect(lossForConvert("html", "docx")).toBe("scripts and layout discarded");
    expect(lossForConvert("pdf", "html")).toBe("images and layout discarded; text only");
    expect(lossForConvert("docx", "md")).toBe(
      "images and complex formatting discarded",
    );
    expect(lossForConvert("pptx", "md")).toBe(
      "notes and images discarded; slide text only",
    );
    expect(lossForConvert("xlsx", "md")).toBe(
      "formulas charts and formatting discarded; tables as text",
    );
  });
});

describe("convertDocument", () => {
  it("converts docx to md with Hello and docx loss", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-cv-docx-"));
    const source = join(dir, "sample.docx");
    const out = join(dir, "out.md");
    await writeHelloDocx(source);
    const result = await convertDocument(source, out);
    expect(result).toEqual({
      from: "docx",
      format: "md",
      loss: "images and complex formatting discarded",
    });
    expect(readFileSync(out, "utf8")).toContain("Hello");
  });

  it("converts pdf to html with Hello and pdf loss", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-cv-pdf-"));
    const source = join(dir, "sample.pdf");
    const out = join(dir, "out.html");
    writeFileSync(source, HELLO_PDF);
    const result = await convertDocument(source, out);
    expect(result.from).toBe("pdf");
    expect(result.format).toBe("html");
    expect(result.loss).toBe("images and layout discarded; text only");
    expect(readFileSync(out, "utf8")).toContain("Hello");
  });

  it("converts hello.md to pdf and md-to-md keeps images", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-cv-md-"));
    const source = join(dir, "hello.md");
    writeFileSync(source, helloMd);
    const pdfOut = join(dir, "out.pdf");
    await convertDocument(source, pdfOut);
    expect(await parse(pdfOut)).toContain("Hello");
    expect(await parse(pdfOut)).toContain("发展");

    const mdOut = join(dir, "copy.md");
    const result = await convertDocument(source, mdOut);
    expect(result).toEqual({ from: "md", format: "md", loss: "none" });
    expect(readFileSync(mdOut, "utf8")).toContain("![skip](x.png)");
  });

  it("converts xlsx to md with cell text", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-cv-xlsx-"));
    const source = join(dir, "sample.xlsx");
    const out = join(dir, "out.md");
    await writeHelloXlsx(source);
    const result = await convertDocument(source, out);
    expect(result.from).toBe("xlsx");
    expect(result.loss).toBe(
      "formulas charts and formatting discarded; tables as text",
    );
    const text = readFileSync(out, "utf8");
    expect(text).toContain("Hello");
  });

  it("converts md to xlsx and pptx with md loss", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-cv-office-out-"));
    const source = join(dir, "hello.md");
    writeFileSync(source, "# Hello\n\n发展\n");
    const xlsxOut = join(dir, "out.xlsx");
    const pptxOut = join(dir, "out.pptx");
    const xlsxResult = await convertDocument(source, xlsxOut);
    expect(xlsxResult).toEqual({
      from: "md",
      format: "xlsx",
      loss: "images skipped; emphasis flattened",
    });
    expect(await parse(xlsxOut)).toContain("Hello");
    const pptxResult = await convertDocument(source, pptxOut);
    expect(pptxResult).toEqual({
      from: "md",
      format: "pptx",
      loss: "images skipped; emphasis flattened",
    });
    expect(await parse(pptxOut)).toContain("Hello");
  });

  it("empty pdf is empty text and does not write out", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-cv-empty-"));
    const source = join(dir, "empty.pdf");
    const out = join(dir, "out.md");
    writeFileSync(source, EMPTY_PDF);
    await expect(convertDocument(source, out)).rejects.toThrow(/empty text/);
    expect(existsSync(out)).toBe(false);
  });

  it("embeds a sibling png when converting markdown to docx", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-cv-img-"));
    writeFileSync(join(dir, "map.png"), PNG_1x1);
    writeFileSync(join(dir, "note.md"), "# 路径图\n\n![map](map.png)\n");
    const out = join(dir, "out.docx");
    await convertDocument(join(dir, "note.md"), out);
    const zip = await JSZip.loadAsync(readFileSync(out));
    expect(Object.keys(zip.files).some((name) => name.startsWith("word/media/"))).toBe(true);
  });

  it("does not follow image paths outside the markdown folder", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-cv-esc-"));
    const nest = join(dir, "nested");
    mkdirSync(nest);
    writeFileSync(join(dir, "secret.png"), PNG_1x1);
    writeFileSync(join(nest, "note.md"), "![x](../secret.png)\n# Hi\n");
    const out = join(nest, "out.docx");
    await convertDocument(join(nest, "note.md"), out);
    const zip = await JSZip.loadAsync(readFileSync(out));
    expect(Object.keys(zip.files).some((name) => name.startsWith("word/media/"))).toBe(false);
  });

  it("overwrites an existing out file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-cv-ow-"));
    const source = join(dir, "hello.md");
    const out = join(dir, "out.md");
    writeFileSync(source, "# Hello\n");
    writeFileSync(out, "OLD\n");
    await convertDocument(source, out);
    expect(readFileSync(out, "utf8")).toContain("Hello");
    expect(readFileSync(out, "utf8")).not.toContain("OLD");
  });

  it("too-large bytes and truncated parse do not write out", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-cv-big-"));
    const huge = join(dir, "huge.md");
    const hugeOut = join(dir, "huge.md.out.md");
    writeFileSync(huge, Buffer.alloc(GENERATE_MAX_BYTES + 1, 0x61));
    await expect(convertDocument(huge, hugeOut)).rejects.toThrow(/too large/);
    expect(existsSync(hugeOut)).toBe(false);

    const long = join(dir, "long.md");
    const longOut = join(dir, "long.out.md");
    writeFileSync(long, "a".repeat(200_001));
    await expect(convertDocument(long, longOut)).rejects.toThrow(/too large/);
    expect(existsSync(longOut)).toBe(false);
  });

  it("directory source is unreadable and leaves out unchanged", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-cv-dir-"));
    const out = join(dir, "old.md");
    writeFileSync(out, "OLD");
    await expect(convertDocument(dir, out)).rejects.toThrow(/unreadable/);
    expect(readFileSync(out, "utf8")).toBe("OLD");
  });

  it("converts md that starts with failed prefix plus body", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-cv-prefix-"));
    const source = join(dir, "tricky.md");
    const out = join(dir, "out.md");
    writeFileSync(source, "failed: empty text\n# Hello\n");
    await convertDocument(source, out);
    expect(readFileSync(out, "utf8")).toContain("Hello");
  });

  it("rejects unknown binary as unsupported type", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-cv-bin-"));
    const source = join(fixtures, "binary.bin");
    const out = join(dir, "out.md");
    await expect(convertDocument(source, out)).rejects.toThrow(/unsupported type/);
    expect(existsSync(out)).toBe(false);
  });
});
