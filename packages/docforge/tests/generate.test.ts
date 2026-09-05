import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import JSZip from "jszip";
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
    expect(formatFromOutRelPath("out.xlsx")).toBe("xlsx");
    expect(formatFromOutRelPath("deck.PPTX")).toBe("pptx");
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

  it("embeds png data-uri images in docx", async () => {
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const buf = await buildDocument(
      "docx",
      `# Hello\n\n![chart](data:image/png;base64,${png})\n`,
    );
    const zip = await JSZip.loadAsync(buf);
    const media = Object.keys(zip.files).filter((name) => name.startsWith("word/media/"));
    expect(media.length).toBeGreaterThan(0);
  });

  it("centers tables and stretches them to page width", async () => {
    const buf = await buildDocument(
      "docx",
      "| 类别 | 数值 |\n| --- | --- |\n| 1月 | 120 |\n",
    );
    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toMatch(/w:jc[^>]*w:val="center"/);
    expect(xml).toMatch(/w:tblW[^>]*w:type="pct"/);
    expect(xml).toMatch(/w:tblW[^>]*w:w="100%"/);
  });

  it("turns markdown bold into Word bold and strips the asterisks", async () => {
    const buf = await buildDocument(
      "docx",
      "- **雷达图**显示当前人才模型优势\n- **热力图**反映业务活跃度\n",
    );
    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain("雷达图");
    expect(xml).toContain("热力图");
    expect(xml).not.toContain("**");
    const runs = xml.match(/<w:r\b[\s\S]*?<\/w:r>/g) ?? [];
    const radar = runs.find((run) => run.includes("雷达图"));
    const heat = runs.find((run) => run.includes("热力图"));
    expect(radar).toMatch(/<w:b\b/);
    expect(heat).toMatch(/<w:b\b/);
  });

  it("keeps chinese text and marks it as east-asia so Word does not remap bytes", async () => {
    const buf = await buildDocument("docx", "# 数学基础\n\n线性代数 & 微积分\n");
    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain("数学基础");
    expect(xml).toContain("线性代数");
    expect(xml).not.toContain("鏁板");
    expect(xml).toMatch(/w:eastAsia="zh-CN"/);
    expect(xml).toMatch(/w:hint="eastAsia"/);
  });

  it("keeps title emoji on a color-emoji font without the body text color", async () => {
    const buf = await buildDocument("docx", "# 📊 2024年上半年业务分析报告\n");
    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain("📊");
    expect(xml).toMatch(/w:rFonts[^>]*w:ascii="Segoe UI Emoji"/);
    const emojiRun = (xml.match(/<w:r\b[\s\S]*?<\/w:r>/g) ?? []).find((run) => run.includes("📊"));
    expect(emojiRun).toBeTruthy();
    expect(emojiRun).not.toMatch(/w:color[^>]*w:val="111827"/);
  });

  it("uses dark readable table text and header shading", async () => {
    const buf = await buildDocument(
      "docx",
      "| 类别 | 数值 |\n| --- | --- |\n| 1月 | 120 |\n",
    );
    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toMatch(/w:color[^>]*w:val="111827"/);
    expect(xml).toMatch(/w:shd[^>]*w:fill="F3F4F6"/);
    expect(xml).toMatch(/w:sz[^>]*w:val="22"/);
  });

  it("keeps space between tables and images in Word output", async () => {
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const buf = await buildDocument(
      "docx",
      ["| 类别 | 数值 |", "| --- | --- |", "| 1月 | 120 |", "", `![chart](data:image/png;base64,${png})`].join(
        "\n",
      ),
    );
    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toMatch(/<\/w:tbl><w:p>/);
    expect(xml).toMatch(/w:spacing[^>]*w:before="240"/);
    expect(xml).toMatch(/w:spacing[^>]*w:after="240"/);
    expect(xml).toMatch(/w:jc[^>]*w:val="center"/);
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

it("xlsx and pptx round-trip Hello through parse", async () => {
  const dir = mkdtempSync(join(tmpdir(), "flintloom-gen-office-"));
  const source = join(dir, "hello.md");
  writeFileSync(source, helloMd);
  const xlsxPath = join(dir, "hello.xlsx");
  const pptxPath = join(dir, "hello.pptx");
  await generateDocument(source, xlsxPath);
  await generateDocument(source, pptxPath);
  expect(await parse(xlsxPath)).toContain("Hello");
  expect(await parse(pptxPath)).toContain("Hello");
});

it("pptx is an Office package PowerPoint can open", async () => {
  const dir = mkdtempSync(join(tmpdir(), "flintloom-gen-pptx-pkg-"));
  const source = join(dir, "hello.md");
  writeFileSync(source, helloMd);
  const pptxPath = join(dir, "hello.pptx");
  await generateDocument(source, pptxPath);
  const zip = await JSZip.loadAsync(readFileSync(pptxPath));
  const names = Object.keys(zip.files);
  expect(names).toContain("_rels/.rels");
  expect(names).toContain("ppt/presentation.xml");
  expect(names).toContain("ppt/_rels/presentation.xml.rels");
  expect(names).toContain("ppt/slideMasters/slideMaster1.xml");
  expect(names).toContain("ppt/slideLayouts/slideLayout1.xml");
  expect(names).toContain("ppt/theme/theme1.xml");
  expect(names).toContain("ppt/slides/_rels/slide1.xml.rels");
  const rels = await zip.file("_rels/.rels")!.async("string");
  expect(rels).toContain("ppt/presentation.xml");
  const presentation = await zip.file("ppt/presentation.xml")!.async("string");
  expect(presentation).toContain("sldId");
  const slide = await zip.file("ppt/slides/slide1.xml")!.async("string");
  expect(slide).toContain("nvGrpSpPr");
  expect(slide).toContain("Hello");
  expect(slide).toContain('srgbClr val="FFFFFF"');
  expect(slide).toContain('srgbClr val="1A1A2E"');
  expect(slide).not.toContain("<p:ph");
});

it("json blocks source writes xlsx with Hello", async () => {
  const dir = mkdtempSync(join(tmpdir(), "flintloom-gen-json-"));
  const source = join(dir, "doc.json");
  writeFileSync(
    source,
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures/hello.document.json")),
  );
  const out = join(dir, "out.xlsx");
  await generateDocument(source, out);
  expect(await parse(out)).toContain("Hello");
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

it("rejects markdown over GENERATE_MAX_CHARS under byte cap", async () => {
  const dir = mkdtempSync(join(tmpdir(), "flintloom-gen-chars-"));
  const overChars = join(dir, "over-chars.md");
  writeFileSync(overChars, "a".repeat(200_001));
  await expect(generateDocument(overChars, join(dir, "out.pdf"))).rejects.toThrow(
    /too large/,
  );
});
