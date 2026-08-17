import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "../src/parse.ts";
import { probe } from "../src/probe.ts";
import { EMPTY_PDF, HELLO_PDF } from "./helpers/pdf.ts";
import {
  writeDocxWithImage,
  writeFormulaXlsx,
  writeHelloDocx,
  writeHelloPptx,
  writeHelloXlsx,
} from "./helpers/office.ts";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");


describe("probe/parse md html unknown", () => {
  it("probes and parses markdown and html", async () => {
    const mdProbe = await probe(join(fixtures, "sample.md"));
    expect(mdProbe).toEqual({ type: "md", parseable: true });
    expect(await parse(join(fixtures, "sample.md"))).toContain("Hello");

    const htmlProbe = await probe(join(fixtures, "sample.html"));
    expect(htmlProbe).toEqual({ type: "html", parseable: true });
    expect(await parse(join(fixtures, "sample.html"))).toMatch(/Hello/);
  });

  it("rejects unknown binary", async () => {
    const result = await probe(join(fixtures, "binary.bin"));
    expect(result.type).toBe("unknown");
    expect(result.parseable).toBe(false);
    expect(await parse(join(fixtures, "binary.bin"))).toBe(
      "failed: unsupported type",
    );
  });

  it("reports not found", async () => {
    const missing = join(fixtures, "no-such-file.md");
    expect(await probe(missing)).toEqual({
      type: "unknown",
      parseable: false,
      reason: "not found",
    });
    expect(await parse(missing)).toBe("failed: not found");
  });

  it("strips BOM and truncates long markdown", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-doc-"));
    const bomPath = join(dir, "bom.md");
    writeFileSync(bomPath, "\uFEFF# Hello\n");
    expect(await parse(bomPath)).toBe("# Hello\n");

    const longPath = join(dir, "long.md");
    writeFileSync(longPath, "a".repeat(200_001));
    const text = await parse(longPath);
    expect(text.startsWith("a".repeat(200_000))).toBe(true);
    expect(text).toContain(
      "[truncated: output exceeded 200000 characters]",
    );
  });

  it("parses pdf pages and rejects empty text", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-pdf-"));
    const helloPath = join(dir, "sample.pdf");
    const emptyPath = join(dir, "empty.pdf");
    writeFileSync(helloPath, HELLO_PDF);
    writeFileSync(emptyPath, EMPTY_PDF);

    const helloProbe = await probe(helloPath);
    expect(helloProbe.type).toBe("pdf");
    expect(helloProbe.parseable).toBe(true);
    expect(helloProbe.pages).toBe(1);
    const hello = await parse(helloPath);
    expect(hello).toContain("## Page 1");
    expect(hello).toContain("Hello");

    expect(await parse(emptyPath)).toBe("failed: empty text");
  });

  it("parses docx pptx and xlsx", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-office-"));
    const docxPath = join(dir, "sample.docx");
    const pptxPath = join(dir, "sample.pptx");
    const xlsxPath = join(dir, "sample.xlsx");
    await writeHelloDocx(docxPath);
    await writeHelloPptx(pptxPath);
    await writeHelloXlsx(xlsxPath);

    expect((await probe(docxPath)).parseable).toBe(true);
    expect(await parse(docxPath)).toContain("Hello");

    const pptxProbe = await probe(pptxPath);
    expect(pptxProbe.parseable).toBe(true);
    expect(pptxProbe.pages).toBe(1);
    const pptxMd = await parse(pptxPath);
    expect(pptxMd).toContain("## Slide 1");
    expect(pptxMd).toContain("Hello");

    const xlsxProbe = await probe(xlsxPath);
    expect(xlsxProbe.parseable).toBe(true);
    expect(xlsxProbe.pages).toBe(1);
    const xlsxMd = await parse(xlsxPath);
    expect(xlsxMd).toContain("##");
    expect(xlsxMd).toContain("Hello");
  });

  it("treats macro-enabled docm as unsupported even with docx bytes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-docm-"));
    const path = join(dir, "x.docm");
    await writeHelloDocx(path);
    expect(await parse(path)).toBe("failed: unsupported type");
  });

  it("parses docx images as placeholders without data URIs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-docx-img-"));
    const path = join(dir, "picture.docx");
    await writeDocxWithImage(path);
    const md = await parse(path);
    expect(md).not.toMatch(/data:image/i);
    expect(md).not.toMatch(/base64/i);
    expect(md).toMatch(/tiny|\[image\]/i);
  });

  it("probes truncated docx as unreadable", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-bad-docx-"));
    const path = join(dir, "bad.docx");
    writeFileSync(path, Buffer.from("PK\x03\x04garbage-not-a-zip"));
    const result = await probe(path);
    expect(result.type).toBe("docx");
    expect(result.parseable).toBe(false);
    expect(result.reason).toMatch(/unreadable|encrypted/);
  });

  it("parses xlsx formula and richText cells without [object Object]", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-xlsx-cells-"));
    const path = join(dir, "cells.xlsx");
    await writeFormulaXlsx(path);
    const md = await parse(path);
    expect(md).not.toContain("[object Object]");
    expect(md).toContain("2");
    expect(md).toContain("RichText");
    expect(md).toContain("2026-08-16");
    expect(md).toContain("#DIV/0!");
  });
});
