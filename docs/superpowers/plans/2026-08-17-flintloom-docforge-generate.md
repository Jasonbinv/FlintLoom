# FlintLoom DocForge generate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agent 能对工作区 markdown 调用 `doc_generate({ source, out })`，按 `out` 扩展名写出 md / html / docx / pdf；`parse()` 能从生成的 pdf/docx 读回 `Hello` 和「发展」。

**Architecture:** 纯函数在 `@flintloom/docforge`：`parseBlocks` → `buildDocument`（内存 Buffer）→ `generateDocument` 一次 `writeFile`。工具 `createDocGenerateTool` 做路径闸门后调用纯函数，经现有 `apply` 登记。不改 host 组装、不改 preview `kind`、不 mkdir。

**Tech Stack:** `marked`（lexer + gfm）、`docx`、`pdfkit`（CJS，用 `createRequire`）、包内 `NotoSansSC-Regular.otf`（Noto CJK SubsetOTF，SIL OFL）。禁止 pandoc / Chrome / LibreOffice / 运行时下载字体。

## Global Constraints

- 产品名 FlintLoom；包前缀 `@flintloom/*`；只绑 `127.0.0.1`。
- 不 import / submodule / 拷贝 dataagent-v3、deepseek-harness、Cordis。
- 禁止往 `createRuntime` 里 `register`。`apps/host/src` 不得出现 `createDocGenerateTool`；不要用正则禁止单词 `generate`。
- `packages/loop/src`、`packages/session/src`、`apps/desktop/src` 不得出现 `generateDocument` / `parseBlocks`。
- `detectType(path, bytes)` 两参数；先 `stat.size > 800000` 再 `readFile`。
- PDF 用 `text()` 嵌包内字体；docx **不**嵌入 ODTTF。
- 失败短英文只允许：`missing source` / `missing out` / `hidden` / `not found` / `not a file` / `bad source` / `bad out` / `missing parent` / `too large` / `unreadable`。
- Windows 提交指定文件；不要 `git add -A`。

Spec：`docs/superpowers/specs/2026-08-17-flintloom-docforge-generate-design.md`

## File map

```text
packages/docforge/package.json          # + marked, docx, pdfkit, @types/pdfkit
packages/docforge/src/blocks.ts         # parseBlocks
packages/docforge/src/html.ts           # renderHtml
packages/docforge/src/generate-types.ts # Block, GenerateFormat, MAX_*
packages/docforge/src/generate.ts       # formatFromOutRelPath, copyMarkdown, buildDocument, generateDocument
packages/docforge/src/font.ts           # defaultFontPath via import.meta.url
packages/docforge/src/writers/docx.ts
packages/docforge/src/writers/pdf.ts
packages/docforge/src/tools.ts          # createDocGenerateTool
packages/docforge/src/index.ts          # exports + apply 登记
packages/docforge/fonts/NotoSansSC-Regular.otf
packages/docforge/fonts/OFL.txt
packages/docforge/tests/fixtures/hello.md
packages/docforge/tests/blocks.test.ts
packages/docforge/tests/generate.test.ts
packages/docforge/tests/tools.test.ts   # 追加 generate 用例
packages/docforge/tests/plugin.test.ts  # schemas 含 doc_generate
apps/host/tests/server.test.ts          # factory 扫描 + yml 去掉 docforge
```

---

### Task 1: parseBlocks + md/html buildDocument

**Files:**
- Modify: `packages/docforge/package.json`（依赖 `marked`）
- Create: `packages/docforge/src/blocks.ts`
- Create: `packages/docforge/src/html.ts`
- Create: `packages/docforge/src/generate-types.ts`
- Create: `packages/docforge/src/generate.ts`
- Create: `packages/docforge/tests/blocks.test.ts`
- Create: `packages/docforge/tests/generate.test.ts`
- Modify: `packages/docforge/src/index.ts`（导出新符号；本任务还不登记工具）

**Interfaces:**
- Consumes: 无
- Produces:

```ts
export const GENERATE_MAX_CHARS = 200_000;
export const GENERATE_MAX_BYTES = 800_000;
export type GenerateFormat = "md" | "html" | "docx" | "pdf";
export type Block =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "code"; text: string }
  | { type: "table"; headers: string[]; rows: string[][] };
export function formatFromOutRelPath(relPath: string): GenerateFormat | undefined;
export function parseBlocks(markdown: string): Block[];
export function copyMarkdown(raw: string): string;
export function renderHtml(blocks: Block[]): string;
export async function buildDocument(
  format: GenerateFormat,
  markdown: string,
  opts?: { fontPath?: string },
): Promise<Buffer>;
```

本任务 `buildDocument` 只实现 `md` / `html`；`docx` / `pdf` 抛 `Error("unreadable")`。

- [ ] **Step 1: 安装 marked**

```bash
pnpm add -F @flintloom/docforge marked
```

- [ ] **Step 2: 写失败测试**

`packages/docforge/tests/blocks.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseBlocks } from "../src/blocks.ts";

describe("parseBlocks", () => {
  it("keeps headings lists tables and skips images", () => {
    const blocks = parseBlocks(
      [
        "# Hello",
        "",
        "发展 and [x](http://example.com) plus **bold**",
        "",
        "- a",
        "  - b",
        "",
        "```",
        "code & <>",
        "```",
        "",
        "| H |",
        "| --- |",
        "| 1 |",
        "",
        "![skip](x.png)",
      ].join("\n"),
    );
    expect(blocks).toContainEqual({ type: "heading", level: 1, text: "Hello" });
    expect(blocks.some((b) => b.type === "paragraph" && b.text.includes("发展"))).toBe(
      true,
    );
    expect(blocks.some((b) => b.type === "paragraph" && b.text.includes("x"))).toBe(
      true,
    );
    expect(blocks.some((b) => b.type === "paragraph" && b.text.includes("http://"))).toBe(
      false,
    );
    const list = blocks.find((b) => b.type === "list");
    expect(list).toEqual({ type: "list", ordered: false, items: ["a", "b"] });
    expect(blocks).toContainEqual({ type: "code", text: "code & <>" });
    expect(blocks).toContainEqual({
      type: "table",
      headers: ["H"],
      rows: [["1"]],
    });
    expect(blocks.some((b) => b.type === "paragraph" && b.text.includes("skip"))).toBe(
      false,
    );
  });
});
```

`packages/docforge/tests/generate.test.ts`（本任务只测 md/html）：

```ts
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
    expect(html).toContain("<meta charset=\"utf-8\">");
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
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm exec vitest run packages/docforge/tests/blocks.test.ts packages/docforge/tests/generate.test.ts`

Expected: FAIL（模块不存在）

- [ ] **Step 4: 实现**

`packages/docforge/src/blocks.ts`:

```ts
import { marked, type Token, type Tokens } from "marked";
import type { Block } from "./generate.ts";

function flattenInline(tokens: Token[] | undefined): string {
  if (!tokens) {
    return "";
  }
  let out = "";
  for (const token of tokens) {
    switch (token.type) {
      case "image":
        break;
      case "link": {
        const label = flattenInline(token.tokens);
        out += label.length > 0 ? label : token.text;
        break;
      }
      case "strong":
      case "em":
      case "del":
        out += flattenInline(token.tokens);
        break;
      case "codespan":
      case "text":
      case "escape":
        out += token.text;
        break;
      case "br":
        out += " ";
        break;
      case "html":
        break;
      default:
        if ("tokens" in token && Array.isArray(token.tokens)) {
          out += flattenInline(token.tokens);
        } else if ("text" in token && typeof token.text === "string") {
          out += token.text;
        }
    }
  }
  return out;
}

function listItems(items: Tokens.ListItem[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    out.push(...flattenListItem(item.tokens ?? []));
  }
  return out;
}

function flattenListItem(tokens: Token[]): string[] {
  const texts: string[] = [];
  let current = "";
  for (const token of tokens) {
    if (token.type === "list") {
      if (current.trim().length > 0) {
        texts.push(current.trim());
        current = "";
      }
      texts.push(...listItems(token.items));
    } else {
      current += flattenInline([token]);
    }
  }
  if (current.trim().length > 0) {
    texts.push(current.trim());
  }
  return texts.length > 0 ? texts : [""];
}

function walk(tokens: Token[]): Block[] {
  const blocks: Block[] = [];
  for (const token of tokens) {
    switch (token.type) {
      case "heading": {
        const level = Math.min(6, Math.max(1, token.depth)) as 1 | 2 | 3 | 4 | 5 | 6;
        blocks.push({ type: "heading", level, text: flattenInline(token.tokens) });
        break;
      }
      case "paragraph": {
        const text = flattenInline(token.tokens).trim();
        if (text.length > 0) {
          blocks.push({ type: "paragraph", text });
        }
        break;
      }
      case "blockquote":
        blocks.push(...walk(token.tokens ?? []));
        break;
      case "list":
        blocks.push({
          type: "list",
          ordered: token.ordered === true,
          items: listItems(token.items),
        });
        break;
      case "code":
        blocks.push({ type: "code", text: token.text.replace(/\n$/, "") });
        break;
      case "table": {
        const headers = token.header.map((cell) => flattenInline(cell.tokens));
        const rows = token.rows.map((row) => {
          const cells = row.map((cell) => flattenInline(cell.tokens));
          while (cells.length < headers.length) {
            cells.push("");
          }
          return cells;
        });
        blocks.push({ type: "table", headers, rows });
        break;
      }
      case "space":
      case "hr":
      case "html":
      case "def":
        break;
      default:
        break;
    }
  }
  return blocks;
}

export function parseBlocks(markdown: string): Block[] {
  return walk(marked.lexer(markdown, { gfm: true }));
}
```

**必须**把 `Block` / `GenerateFormat` / 两个 MAX 常量放到 `packages/docforge/src/generate-types.ts`。`blocks.ts` / `html.ts` / `generate.ts` / writers 只从该文件 import 类型。禁止 `blocks.ts` ↔ `generate.ts` 循环 import。

`packages/docforge/src/html.ts`:

```ts
import type { Block } from "./generate.ts";

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderHtml(blocks: Block[]): string {
  const heading = blocks.find((b) => b.type === "heading");
  const title = heading ? escapeHtml(heading.text) : "";
  const body = blocks
    .map((block) => {
      switch (block.type) {
        case "heading":
          return `<h${block.level}>${escapeHtml(block.text)}</h${block.level}>`;
        case "paragraph":
          return `<p>${escapeHtml(block.text)}</p>`;
        case "list": {
          const tag = block.ordered ? "ol" : "ul";
          const items = block.items
            .map((item) => `<li>${escapeHtml(item)}</li>`)
            .join("");
          return `<${tag}>${items}</${tag}>`;
        }
        case "code":
          return `<pre>${escapeHtml(block.text)}</pre>`;
        case "table": {
          const head = `<tr>${block.headers
            .map((h) => `<th>${escapeHtml(h)}</th>`)
            .join("")}</tr>`;
          const rows = block.rows
            .map(
              (row) =>
                `<tr>${row.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`,
            )
            .join("");
          return `<table>${head}${rows}</table>`;
        }
      }
    })
    .join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
}
```

标题查找写一次变量，不要双 `find`。

`packages/docforge/src/generate.ts`:

```ts
import { parseBlocks, type Block } from "./blocks.ts";
import { renderHtml } from "./html.ts";

export const GENERATE_MAX_CHARS = 200_000;
export const GENERATE_MAX_BYTES = 800_000;

export type GenerateFormat = "md" | "html" | "docx" | "pdf";

export type Block =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "code"; text: string }
  | { type: "table"; headers: string[]; rows: string[][] };

export function formatFromOutRelPath(relPath: string): GenerateFormat | undefined {
  const lower = relPath.replaceAll("\\", "/").toLowerCase();
  if (lower.endsWith(".md")) return "md";
  if (lower.endsWith(".html")) return "html";
  if (lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".pdf")) return "pdf";
  return undefined;
}

export function copyMarkdown(raw: string): string {
  const body = raw.startsWith("\uFEFF") ? raw.slice(1) : raw;
  return body.endsWith("\n") ? body : `${body}\n`;
}

export async function buildDocument(
  format: GenerateFormat,
  markdown: string,
  _opts?: { fontPath?: string },
): Promise<Buffer> {
  switch (format) {
    case "md":
      return Buffer.from(copyMarkdown(markdown), "utf8");
    case "html":
      return Buffer.from(renderHtml(parseBlocks(markdown)), "utf8");
    default:
      throw new Error("unreadable");
  }
}
```

**不要**在 `generate.ts` 和 `blocks.ts` 两边都 `export type Block`。选一种：

- `generate-types.ts` 导出 `Block` / `GenerateFormat` / 两个 MAX 常量；或
- `blocks.ts` 导出 `Block`，`generate.ts` re-export。

`index.ts` 增加：

```ts
export type { Block, GenerateFormat } from "./generate.ts";
export {
  GENERATE_MAX_BYTES,
  GENERATE_MAX_CHARS,
  buildDocument,
  formatFromOutRelPath,
  parseBlocks,
} from "./generate.ts";
```

`parseBlocks` 若从 `blocks.ts` 导出，index 从 `blocks.ts` re-export。

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm exec vitest run packages/docforge/tests/blocks.test.ts packages/docforge/tests/generate.test.ts`

Expected: PASS。若 nested list 不是 `["a","b"]`，按实际 marked 结构改 `flattenListItem`，断言跟着实现，但必须压成一层且包含 `a` 和 `b`。

- [ ] **Step 6: Commit**

```bash
git add packages/docforge/package.json packages/docforge/src/blocks.ts packages/docforge/src/html.ts packages/docforge/src/generate.ts packages/docforge/src/generate-types.ts packages/docforge/src/index.ts packages/docforge/tests/blocks.test.ts packages/docforge/tests/generate.test.ts pnpm-lock.yaml
git commit -m "feat: parse markdown blocks for document generate"
```

（没有 `generate-types.ts` 就不要 add 它。）

---

### Task 2: 字体 + docx/pdf + generateDocument

**Files:**
- Create: `packages/docforge/fonts/NotoSansSC-Regular.otf`
- Create: `packages/docforge/fonts/OFL.txt`
- Create: `packages/docforge/src/font.ts`
- Create: `packages/docforge/src/writers/docx.ts`
- Create: `packages/docforge/src/writers/pdf.ts`
- Create: `packages/docforge/tests/fixtures/hello.md`
- Modify: `packages/docforge/package.json`（+ `docx` `pdfkit` `@types/pdfkit`）
- Modify: `packages/docforge/src/generate.ts`（`buildDocument` 接 docx/pdf；加 `generateDocument`）
- Modify: `packages/docforge/src/index.ts`
- Modify: `packages/docforge/tests/generate.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `parseBlocks` / `buildDocument` / `formatFromOutRelPath` / `copyMarkdown`
- Produces:

```ts
export function defaultFontPath(): string;
export async function generateDocument(
  absSource: string,
  absOut: string,
): Promise<{ format: GenerateFormat }>;
```

`buildDocument("pdf"|"docx", markdown)` 返回完整 Buffer，不写盘。

- [ ] **Step 1: 依赖与字体**

```bash
pnpm add -F @flintloom/docforge docx pdfkit
pnpm add -D -F @flintloom/docforge @types/pdfkit
```

字体在 GitHub 仓库里是 LFS，**不要** curl `raw.githubusercontent.com`（会拿到 pointer）。从 release zip 取 SubsetOTF：

```powershell
New-Item -ItemType Directory -Force -Path packages/docforge/fonts | Out-Null
$zip = Join-Path $env:TEMP "NotoSansSC.zip"
curl.exe -L -o $zip "https://github.com/notofonts/noto-cjk/releases/download/Sans2.004/08_NotoSansSC.zip"
Expand-Archive -Path $zip -DestinationPath (Join-Path $env:TEMP "NotoSansSC") -Force
Copy-Item -Force (Join-Path $env:TEMP "NotoSansSC\SubsetOTF\SC\NotoSansSC-Regular.otf") packages/docforge/fonts/NotoSansSC-Regular.otf
```

若 zip 内路径不同，在解压目录里找 `NotoSansSC-Regular.otf` 再 copy。文件必须是真实 OTF（前四个字节不是 `vers` / `git-lfs`）。`OFL.txt` 从同一仓库 LICENSE 拷入 `packages/docforge/fonts/OFL.txt`（SIL OFL 全文）。

- [ ] **Step 2: 写失败测试**

夹具 `packages/docforge/tests/fixtures/hello.md`：

```md
# Hello

发展 is the topic.

| Col |
| --- |
| x |

![skip](x.png)
```

追加到 `generate.test.ts`：

```ts
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "../src/parse.ts";
import { buildDocument, generateDocument } from "../src/generate.ts";

const helloMd = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "fixtures/hello.md"),
  "utf8",
);

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
```

`generateDocument(dir, out)` 依赖对目录 `readFile` 得到 EISDIR → `unreadable`。不要先把目录当 md 读进 200k 字符。

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm exec vitest run packages/docforge/tests/generate.test.ts`

Expected: FAIL（`generateDocument` 未定义或 pdf 仍 `unreadable`）

- [ ] **Step 4: 实现 writers 与 generateDocument**

`packages/docforge/src/font.ts`:

```ts
import { fileURLToPath } from "node:url";
import { join } from "node:path";

export function defaultFontPath(): string {
  return join(fileURLToPath(new URL("./../fonts/NotoSansSC-Regular.otf", import.meta.url)));
}
```

`font.ts` 在 `src/` 下，相对路径是 `../fonts/`。用 `import.meta.url`，禁止 `process.cwd()`。

`packages/docforge/src/writers/pdf.ts`（pdfkit 是 CJS）：

```ts
import { createRequire } from "node:module";
import { access } from "node:fs/promises";
import type { Block } from "../generate.ts";

const PDFDocument = createRequire(import.meta.url)("pdfkit");

export async function renderPdf(blocks: Block[], fontPath: string): Promise<Buffer> {
  try {
    await access(fontPath);
  } catch {
    throw new Error("unreadable");
  }
  return await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 72 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", () => reject(new Error("unreadable")));
    try {
      doc.font(fontPath);
      for (const block of blocks) {
        switch (block.type) {
          case "heading":
            doc.fontSize(Math.max(12, 24 - (block.level - 1) * 2)).text(block.text);
            doc.moveDown(0.4);
            break;
          case "paragraph":
            doc.fontSize(12).text(block.text);
            doc.moveDown(0.4);
            break;
          case "list":
            doc.fontSize(12);
            for (const [i, item] of block.items.entries()) {
              const prefix = block.ordered ? `${i + 1}. ` : "• ";
              doc.text(prefix + item);
            }
            doc.moveDown(0.4);
            break;
          case "code":
            doc.fontSize(11).text(block.text);
            doc.moveDown(0.4);
            break;
          case "table": {
            doc.fontSize(12).text(block.headers.join(" | "));
            for (const row of block.rows) {
              doc.text(row.join(" | "));
            }
            doc.moveDown(0.4);
            break;
          }
        }
      }
      doc.end();
    } catch {
      reject(new Error("unreadable"));
    }
  });
}
```

必须 `doc.text(...)`，禁止把字形画成 path。

`packages/docforge/src/writers/docx.ts`:

```ts
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
} from "docx";
import type { Block } from "../generate.ts";

const FONT = { ascii: "Noto Sans SC", eastAsia: "Noto Sans SC" };

function run(text: string): TextRun {
  return new TextRun({ text, font: FONT });
}

const LEVELS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
] as const;

export async function renderDocx(blocks: Block[]): Promise<Buffer> {
  const children = [];
  for (const block of blocks) {
    switch (block.type) {
      case "heading":
        children.push(
          new Paragraph({
            heading: LEVELS[block.level - 1],
            children: [run(block.text)],
          }),
        );
        break;
      case "paragraph":
        children.push(new Paragraph({ children: [run(block.text)] }));
        break;
      case "list":
        for (const item of block.items) {
          children.push(
            new Paragraph({
              children: [run(item)],
              bullet: block.ordered ? undefined : { level: 0 },
              numbering: block.ordered
                ? { reference: "gen-num", level: 0 }
                : undefined,
            }),
          );
        }
        break;
      case "code":
        children.push(new Paragraph({ children: [run(block.text)] }));
        break;
      case "table":
        children.push(
          new Table({
            rows: [
              new TableRow({
                children: block.headers.map(
                  (h) => new TableCell({ children: [new Paragraph({ children: [run(h)] })] }),
                ),
              }),
              ...block.rows.map(
                (row) =>
                  new TableRow({
                    children: row.map(
                      (c) =>
                        new TableCell({
                          children: [new Paragraph({ children: [run(c)] })],
                        }),
                    ),
                  }),
              ),
            ],
          }),
        );
        break;
    }
  }
  const doc = new Document({
    numbering: {
      config: [
        {
          reference: "gen-num",
          levels: [
            {
              level: 0,
              format: "decimal",
              text: "%1.",
              alignment: "left",
            },
          ],
        },
      ],
    },
    sections: [{ children }],
  });
  const packed = await Packer.toBuffer(doc);
  return Buffer.from(packed);
}
```

若 `docx` 的 `numbering` 形状与此不符，无序列表用 `"• " + item` 普通段落，有序列表用 `"${i+1}. "`，测试只断言 `parse()` 含 Hello / 发展。

`generate.ts` 补全：

```ts
import { stat, readFile, writeFile } from "node:fs/promises";
import { detectType } from "./detect.ts";
import { defaultFontPath } from "./font.ts";
import { parseBlocks } from "./blocks.ts";
import { renderHtml } from "./html.ts";
import { renderDocx } from "./writers/docx.ts";
import { renderPdf } from "./writers/pdf.ts";

export async function buildDocument(
  format: GenerateFormat,
  markdown: string,
  opts?: { fontPath?: string },
): Promise<Buffer> {
  try {
    switch (format) {
      case "md":
        return Buffer.from(copyMarkdown(markdown), "utf8");
      case "html":
        return Buffer.from(renderHtml(parseBlocks(markdown)), "utf8");
      case "docx":
        return await renderDocx(parseBlocks(markdown));
      case "pdf":
        return await renderPdf(parseBlocks(markdown), opts?.fontPath ?? defaultFontPath());
    }
  } catch (err) {
    if (err instanceof Error && err.message === "unreadable") {
      throw err;
    }
    throw new Error("unreadable");
  }
}

export async function generateDocument(
  absSource: string,
  absOut: string,
): Promise<{ format: GenerateFormat }> {
  const format = formatFromOutRelPath(absOut);
  if (format === undefined) {
    throw new Error("bad out");
  }
  let st;
  try {
    st = await stat(absSource);
  } catch (err) {
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? (err as { code: string }).code
        : "";
    if (code === "ENOENT") {
      throw new Error("not found");
    }
    throw new Error("unreadable");
  }
  if (!st.isFile()) {
    throw new Error("unreadable");
  }
  if (st.size > GENERATE_MAX_BYTES) {
    throw new Error("too large");
  }
  const bytes = await readFile(absSource);
  if (detectType(absSource, bytes) !== "md") {
    throw new Error("bad source");
  }
  let raw = bytes.toString("utf8");
  if (raw.startsWith("\uFEFF")) {
    raw = raw.slice(1);
  }
  if (raw.length > GENERATE_MAX_CHARS) {
    throw new Error("too large");
  }
  const payload = await buildDocument(format, raw);
  await writeFile(absOut, payload);
  return { format };
}
```

目录当 source：`stat` 后 `!st.isFile()` → `unreadable`（满足「已有 out 不变」测试）。工具层会把 source 目录映射成 `not a file`，那是 Task 3。

index 增加 `generateDocument`、`defaultFontPath` 导出。

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm exec vitest run packages/docforge/tests/generate.test.ts packages/docforge/tests/parse.test.ts`

Expected: PASS。若 `parse(pdf)` 抽不到中文，检查是否 `doc.font(fontPath)` 在第一段 `text` 之前，以及 OTF 是否真实文件。

- [ ] **Step 6: Commit**

```bash
git add packages/docforge/package.json packages/docforge/src/font.ts packages/docforge/src/writers packages/docforge/src/generate.ts packages/docforge/src/index.ts packages/docforge/fonts packages/docforge/tests/fixtures/hello.md packages/docforge/tests/generate.test.ts pnpm-lock.yaml
git commit -m "feat: generate pdf and docx from workspace markdown"
```

不要把 `$TEMP` 解压目录加进 git。

---

### Task 3: doc_generate 工具 + apply

**Files:**
- Modify: `packages/docforge/src/tools.ts`
- Modify: `packages/docforge/src/index.ts`
- Modify: `packages/docforge/tests/tools.test.ts`
- Modify: `packages/docforge/tests/plugin.test.ts`

**Interfaces:**
- Consumes: `generateDocument`、`formatFromOutRelPath`、`GENERATE_MAX_BYTES`
- Produces: `createDocGenerateTool(): ToolDefinition`，`apply` 在 parse 之后、ingest 之前 `register`

成功 JSON 键顺序：`status`、`source`、`out`、`format`。`source`/`out` 为工作区相对路径，`\` → `/`。

- [ ] **Step 1: 写失败测试**

`tools.test.ts` 追加（保留现有 probe/parse 用例）：

```ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { WorkspaceEscapeError } from "@flintloom/tools";
import { createDocGenerateTool } from "../src/tools.ts";

it("generates html and maps failures", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "flintloom-gtool-"));
  writeFileSync(join(workspace, "hello.md"), "# Hello\n\n发展\n");
  const tool = createDocGenerateTool();
  const exec = createExec(workspace);
  expect(JSON.parse(await tool.execute({ source: "hello.md", out: "out.html" }, exec))).toEqual({
    status: "ok",
    source: "hello.md",
    out: "out.html",
    format: "html",
  });
  expect(readFileSync(join(workspace, "out.html"), "utf8")).toContain("Hello");

  expect(await tool.execute({ out: "a.pdf" }, exec)).toBe("failed: missing source");
  expect(await tool.execute({ source: "hello.md" }, exec)).toBe("failed: missing out");
  expect(await tool.execute({ source: "hello.md", out: "a.pptx" }, exec)).toBe(
    "failed: bad out",
  );
  writeFileSync(join(workspace, "x.docx"), "x");
  expect(await tool.execute({ source: "x.docx", out: "a.pdf" }, exec)).toBe(
    "failed: bad source",
  );
  expect(await tool.execute({ source: "nope.md", out: "a.pdf" }, exec)).toBe(
    "failed: not found",
  );
  expect(await tool.execute({ source: "hello.md", out: "missing/a.pdf" }, exec)).toBe(
    "failed: missing parent",
  );
  expect(await tool.execute({ source: ".env", out: "a.md" }, exec)).toBe("failed: hidden");
  await expect(tool.execute({ source: "../x.md", out: "a.md" }, exec)).rejects.toThrow(
    WorkspaceEscapeError,
  );

  writeFileSync(join(workspace, "old.md"), "OLD\n");
  expect(JSON.parse(await tool.execute({ source: "hello.md", out: "old.md" }, exec)).status).toBe(
    "ok",
  );
  expect(readFileSync(join(workspace, "old.md"), "utf8")).toContain("Hello");
});

it("returns aborted when the generate signal is aborted", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "flintloom-gtool-ab-"));
  const ac = new AbortController();
  ac.abort();
  const tool = createDocGenerateTool();
  expect(
    await tool.execute({ source: "a.md", out: "a.pdf" }, createExec(workspace, ac.signal)),
  ).toBe("aborted");
});
```

`plugin.test.ts`：schemas 增加 `doc_generate`；`stop()` 后不含。

```ts
it("registers doc_generate and drops it on stop", () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), "flintloom-docforge-kb-")), "k.sqlite");
  const ctx = new Context();
  ctx.plugin(modelsPlugin);
  ctx.plugin(toolsPlugin);
  ctx.plugin(knowledgePlugin, { dbPath });
  const stop = ctx.plugin(plugin);
  const names = ctx.require<ToolRegistry>("tools").schemas().map((s) => s.name);
  expect(names).toContain("doc_generate");
  stop();
  expect(ctx.require<ToolRegistry>("tools").schemas().map((s) => s.name)).not.toContain(
    "doc_generate",
  );
});
```

现有 `registers doc_probe...` 用例也 `toContain("doc_generate")`。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run packages/docforge/tests/tools.test.ts packages/docforge/tests/plugin.test.ts`

Expected: FAIL（`createDocGenerateTool` 未导出）

- [ ] **Step 3: 实现工具**

`tools.ts` 增加（hidden / resolve 模式对齐 `ingest.ts`）：

```ts
import { realpathSync } from "node:fs";
import { dirname, relative } from "node:path";
import { stat } from "node:fs/promises";
import { isHiddenRelPath, resolveInside, type ToolDefinition } from "@flintloom/tools";
import {
  GENERATE_MAX_BYTES,
  formatFromOutRelPath,
  generateDocument,
} from "./generate.ts";

const FAIL_REASONS = new Set([
  "missing source",
  "missing out",
  "hidden",
  "not found",
  "not a file",
  "bad source",
  "bad out",
  "missing parent",
  "too large",
  "unreadable",
]);

function strArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "ENOENT"
  );
}

function failFromError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (FAIL_REASONS.has(message)) {
    return `failed: ${message}`;
  }
  return "failed: unreadable";
}

export function createDocGenerateTool(): ToolDefinition {
  return {
    name: "doc_generate",
    description:
      "Write a workspace markdown file to md, html, docx, or pdf. Pass source and out; format is the out extension. Write the markdown with fs first. Do not use this to parse binaries.",
    parameters: {
      type: "object",
      properties: {
        source: { type: "string" },
        out: { type: "string" },
      },
      required: ["source", "out"],
    },
    async execute(args, exec) {
      if (exec.signal.aborted) {
        return "aborted";
      }
      const source = strArg(args, "source");
      if (source === undefined) {
        return "failed: missing source";
      }
      const out = strArg(args, "out");
      if (out === undefined) {
        return "failed: missing out";
      }
      const absSource = resolveInside(exec.workspaceRoot, source);
      const absOut = resolveInside(exec.workspaceRoot, out);
      const realRoot = realpathSync.native(exec.workspaceRoot);
      const sourceRel = relative(realRoot, absSource).replaceAll("\\", "/");
      const outRel = relative(realRoot, absOut).replaceAll("\\", "/");
      if (
        isHiddenRelPath(source) ||
        isHiddenRelPath(out) ||
        isHiddenRelPath(sourceRel) ||
        isHiddenRelPath(outRel)
      ) {
        return "failed: hidden";
      }
      const format = formatFromOutRelPath(outRel);
      if (format === undefined) {
        return "failed: bad out";
      }
      let sourceStat;
      try {
        sourceStat = await stat(absSource);
      } catch (err) {
        if (isNotFound(err)) {
          return "failed: not found";
        }
        return failFromError(err);
      }
      if (!sourceStat.isFile()) {
        return "failed: not a file";
      }
      if (sourceStat.size > GENERATE_MAX_BYTES) {
        return "failed: too large";
      }
      try {
        const parent = await stat(dirname(absOut));
        if (!parent.isDirectory()) {
          return "failed: missing parent";
        }
      } catch (err) {
        if (isNotFound(err)) {
          return "failed: missing parent";
        }
        return failFromError(err);
      }
      try {
        const outStat = await stat(absOut);
        if (!outStat.isFile()) {
          return "failed: not a file";
        }
      } catch (err) {
        if (!isNotFound(err)) {
          return failFromError(err);
        }
      }
      try {
        const result = await generateDocument(absSource, absOut);
        return JSON.stringify({
          status: "ok",
          source: sourceRel,
          out: outRel,
          format: result.format,
        });
      } catch (err) {
        return failFromError(err);
      }
    },
  };
}
```

`index.ts` `apply`：

```ts
ctx.effect(tools.register(createDocProbeTool()));
ctx.effect(tools.register(createDocParseTool()));
ctx.effect(tools.register(createDocGenerateTool()));
ctx.effect(tools.register(createDocIngestTool(kb)));
```

并 `export { createDocGenerateTool }`。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run packages/docforge/tests/tools.test.ts packages/docforge/tests/plugin.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/docforge/src/tools.ts packages/docforge/src/index.ts packages/docforge/tests/tools.test.ts packages/docforge/tests/plugin.test.ts
git commit -m "feat: register doc_generate on the docforge plugin"
```

---

### Task 4: host factory 扫描 + 去掉 docforge

**Files:**
- Modify: `apps/host/tests/server.test.ts`

**Interfaces:**
- Consumes: Task 3 的工具名 `doc_generate`
- Produces: host `src` 不含 `createDocGenerateTool`；yml 无 docforge 行则 schema 无该工具

- [ ] **Step 1: 写失败测试**

在 `host src does not import tool factories` 增加：

```ts
expect(src).not.toMatch(/createDocGenerateTool/);
```

新增：

```ts
it("omitting docforge from yml omits doc_generate", async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-host-nodoc-"));
  const homeDir = mkdtempSync(join(tmpdir(), "flintloom-host-home-"));
  writeFileSync(
    join(workspaceRoot, "flintloom.yml"),
    ASSEMBLY.replace(
      `  - id: docforge\n    name: "@flintloom/docforge"\n`,
      "",
    ),
  );
  const { ctx } = await createRuntime(workspaceRoot, homeDir);
  const names = ctx.require<ToolRegistry>("tools").schemas().map((s) => s.name);
  expect(names).not.toContain("doc_generate");
  expect(names).not.toContain("doc_parse");
});
```

从 `./assembly.ts` import `ASSEMBLY`（该文件已 export）。去掉 docforge 后 knowledge 仍在，boot 必须成功。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run apps/host/tests/server.test.ts`

Expected: factory 扫描 FAIL（还没有那条 expect 时先 FAIL 在 omit 用例若 ASSEMBLY replace 失败则修字符串，使其与 `assembly.ts` 完全一致含换行）。

- [ ] **Step 3: 实现**

只改测试。不要改 `apps/host/src`。若 omit 测试因 yml 缩进 replace 失败，改为按行 filter `id: docforge` 及下一行 `name:`。

- [ ] **Step 4: 全量测试**

Run: `pnpm test`

Expected: 全部 PASS（含现有 parse / ingest / 预览 / 信息图 / A2UI）。

- [ ] **Step 5: Commit**

```bash
git add apps/host/tests/server.test.ts
git commit -m "test: omit docforge drops doc_generate"
```

---

## Spec coverage

| Spec | Task |
|---|---|
| `parseBlocks` / 跳过图片 / 一层列表 / GFM 表 | 1 |
| `formatFromOutRelPath` 小写；拒 `.markdown` `.htm` | 1 |
| md 拷贝去 BOM；html 转义无 img/script | 1 |
| 包内 OTF + OFL；pdf `text()` 嵌入；docx 不 ODTTF | 2 |
| `buildDocument` 内存 Buffer；`generateDocument` 一次 writeFile | 2 |
| `detectType(path, bytes)`；先 size 后读 | 2–3 |
| 工具检查顺序、hidden、missing parent、覆盖 | 3 |
| `apply` 登记；`stop()` 撤销 | 3 |
| host 不 import 工厂；yml 去掉 docforge | 4 |
| 不改 preview kind / A2UI / loop | 全任务都不碰那些文件 |
