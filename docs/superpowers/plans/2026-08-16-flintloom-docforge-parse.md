# FlintLoom DocForge 解析 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agent 能对工作区内的 md/html/pdf/docx/pptx/xlsx 调用 `doc_probe` / `doc_parse`，得到结构化 markdown 或稳定的 `failed:` 行。

**Architecture:** 新包 `@flintloom/docforge` 提供纯函数 `detectType` / `probe` / `parse`。两个工具只做 `resolveInside` + 调纯函数。host `createRuntime` 注册工具。不接 HTTP、不改 `runTurn`、不改工作台。

**Tech Stack:** Node 22、TypeScript、Vitest、`node-html-markdown`、`unpdf`、`mammoth`、`exceljs`、`jszip`。不引入 canvas / pandoc / OCR / dataagent-v3。

## Global Constraints

- 口号与产品名：FlintLoom，A real agent. / 真正的 Agent。
- 包名前缀：`@flintloom/*`。
- 只绑定现有 host `127.0.0.1:7331`；本切片不新开端口。
- 不 import、不 submodule、不拷贝 dataagent-v3 或 deepseek-harness。
- 不改 `runTurn` 语义。不做 Electron、预览 UI、`GET /v1/files*`、知识库、`doc_ingest`、convert/generate/edit/compare/summarize、A2UI。
- md/html 只按 UTF-8。路径走 `resolveInside`。截断 200000 字符。
- 测试夹具不依赖真实 API key、不依赖本机 pandoc/OCR。
- Windows 提交用 Git Bash；PowerShell 不要用 `&&` 或带 `<` 的 commit trailer。
- 若用户要求先不提交：跳过每任务最后的 Commit 步，其余照做。

Spec：`docs/superpowers/specs/2026-08-16-flintloom-docforge-parse-design.md`

## File map

```text
packages/docforge/package.json
packages/docforge/src/types.ts
packages/docforge/src/truncate.ts
packages/docforge/src/detect.ts
packages/docforge/src/probe.ts
packages/docforge/src/parse.ts
packages/docforge/src/parsers/md.ts
packages/docforge/src/parsers/html.ts
packages/docforge/src/parsers/pdf.ts
packages/docforge/src/parsers/docx.ts
packages/docforge/src/parsers/xlsx.ts
packages/docforge/src/parsers/pptx.ts
packages/docforge/src/tools.ts
packages/docforge/src/index.ts
packages/docforge/tests/detect.test.ts
packages/docforge/tests/parse.test.ts
packages/docforge/tests/tools.test.ts
packages/docforge/tests/helpers/pdf.ts
packages/docforge/tests/helpers/office.ts
packages/docforge/tests/fixtures/sample.md
packages/docforge/tests/fixtures/sample.html
packages/docforge/tests/fixtures/binary.bin
apps/host/package.json
apps/host/src/server.ts
apps/host/tests/server.test.ts
```

`pnpm-workspace.yaml` 已包含 `packages/*`，不必改。根 `tsconfig.json` / `vitest.config.ts` 已包含 `packages/*/tests`。

---

### Task 1: 包骨架 + 探测 + md/html 解析

**Files:**
- Create: `packages/docforge/package.json`
- Create: `packages/docforge/src/types.ts`
- Create: `packages/docforge/src/truncate.ts`
- Create: `packages/docforge/src/detect.ts`
- Create: `packages/docforge/src/probe.ts`
- Create: `packages/docforge/src/parse.ts`
- Create: `packages/docforge/src/parsers/md.ts`
- Create: `packages/docforge/src/parsers/html.ts`
- Create: `packages/docforge/src/index.ts`
- Create: `packages/docforge/tests/fixtures/sample.md`
- Create: `packages/docforge/tests/fixtures/sample.html`
- Create: `packages/docforge/tests/fixtures/binary.bin`
- Create: `packages/docforge/tests/detect.test.ts`
- Create: `packages/docforge/tests/parse.test.ts`

**Interfaces:**
- Consumes: `node:fs/promises`、`node-html-markdown`
- Produces:

```ts
export type DocType =
  | "md"
  | "html"
  | "pdf"
  | "docx"
  | "pptx"
  | "xlsx"
  | "unknown";

export type ProbeResult = {
  type: DocType;
  pages?: number;
  parseable: boolean;
  reason?: string;
};

export function detectType(filePath: string, bytes: Uint8Array): DocType;
export async function probe(absPath: string): Promise<ProbeResult>;
export async function parse(absPath: string): Promise<string>;
export function truncateOutput(text: string): string;
```

`parseable === true` 当 `type` 为六种之一且无 `encrypted`/`unreadable`。本任务 `parse` 对 pdf/docx/pptx/xlsx 返回 `failed: unreadable`（后续任务替换为真解析）。`md` 即使正文以 `<html` 开头仍是 `md`。

- [ ] **Step 1: Write failing tests and fixtures**

`packages/docforge/tests/fixtures/sample.md`:

```md
# Hello
```

`packages/docforge/tests/fixtures/sample.html`:

```html
<h1>Hello</h1>
```

`packages/docforge/tests/fixtures/binary.bin`: 任意非文本字节，至少含 `0x00 0x01 0xff`。

`packages/docforge/tests/detect.test.ts`:

```ts
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
```

`packages/docforge/tests/parse.test.ts`:

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "../src/parse.ts";
import { probe } from "../src/probe.ts";

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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run packages/docforge/tests`

Expected: FAIL（模块不存在）。

- [ ] **Step 3: Implement package and md/html parsers**

`packages/docforge/package.json`:

```json
{
  "name": "@flintloom/docforge",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@flintloom/tools": "workspace:*",
    "node-html-markdown": "^1.3.0"
  }
}
```

然后在仓库根执行：`pnpm install`

`packages/docforge/src/types.ts`：按 Interfaces 原样导出 `DocType`、`ProbeResult`。

`packages/docforge/src/truncate.ts`:

```ts
export const OUTPUT_LIMIT = 200_000;

export function truncateOutput(text: string): string {
  if (text.length <= OUTPUT_LIMIT) {
    return text;
  }
  return (
    text.slice(0, OUTPUT_LIMIT) +
    `\n\n[truncated: output exceeded ${OUTPUT_LIMIT} characters]`
  );
}
```

`packages/docforge/src/detect.ts`:

```ts
import { extname } from "node:path";
import type { DocType } from "./types.ts";

const BY_EXT: Record<string, DocType> = {
  ".md": "md",
  ".markdown": "md",
  ".html": "html",
  ".htm": "html",
  ".pdf": "pdf",
  ".docx": "docx",
  ".pptx": "pptx",
  ".xlsx": "xlsx",
};

function looksLikeHtml(bytes: Uint8Array): boolean {
  const head = Buffer.from(bytes.subarray(0, 256))
    .toString("utf8")
    .trimStart()
    .toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html");
}

function looksLikePdf(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  );
}

export function detectType(filePath: string, bytes: Uint8Array): DocType {
  const ext = extname(filePath).toLowerCase();
  const fromExt = BY_EXT[ext];
  if (fromExt !== undefined) {
    return fromExt;
  }
  if (looksLikePdf(bytes)) {
    return "pdf";
  }
  if (looksLikeHtml(bytes)) {
    return "html";
  }
  return "unknown";
}
```

`packages/docforge/src/parsers/md.ts`:

```ts
import { readFile } from "node:fs/promises";

export async function parseMd(absPath: string): Promise<string> {
  const raw = await readFile(absPath, "utf8");
  return raw.startsWith("\uFEFF") ? raw.slice(1) : raw;
}
```

`packages/docforge/src/parsers/html.ts`:

```ts
import { readFile } from "node:fs/promises";
import { NodeHtmlMarkdown } from "node-html-markdown";

export async function parseHtml(absPath: string): Promise<string> {
  const html = await readFile(absPath, "utf8");
  return NodeHtmlMarkdown.translate(html);
}
```

`packages/docforge/src/parse.ts`:

```ts
import { readFile } from "node:fs/promises";
import { detectType } from "./detect.ts";
import { parseHtml } from "./parsers/html.ts";
import { parseMd } from "./parsers/md.ts";
import { truncateOutput } from "./truncate.ts";

function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "ENOENT"
  );
}

export async function parse(absPath: string): Promise<string> {
  let bytes: Buffer;
  try {
    bytes = await readFile(absPath);
  } catch (err) {
    if (isNotFound(err)) {
      return "failed: not found";
    }
    return "failed: unreadable";
  }

  const type = detectType(absPath, bytes);
  let body: string;
  try {
    switch (type) {
      case "md":
        body = await parseMd(absPath);
        break;
      case "html":
        body = await parseHtml(absPath);
        break;
      case "unknown":
        return "failed: unsupported type";
      default:
        return "failed: unreadable";
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/password|encrypt/i.test(message)) {
      return "failed: encrypted";
    }
    return "failed: unreadable";
  }

  const trimmed = body.replace(/\s+/g, " ").trim();
  if (trimmed.length === 0) {
    return "failed: empty text";
  }
  return truncateOutput(body);
}
```

注意：`empty text` 检查只在成功抽出字符串之后。md/html 空白文件也走这条。

`packages/docforge/src/probe.ts`:

```ts
import { readFile } from "node:fs/promises";
import { detectType } from "./detect.ts";
import type { DocType, ProbeResult } from "./types.ts";

const PARSEABLE: ReadonlySet<DocType> = new Set([
  "md",
  "html",
  "pdf",
  "docx",
  "pptx",
  "xlsx",
]);

function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "ENOENT"
  );
}

export async function probe(absPath: string): Promise<ProbeResult> {
  let bytes: Buffer;
  try {
    bytes = await readFile(absPath);
  } catch (err) {
    if (isNotFound(err)) {
      return { type: "unknown", parseable: false, reason: "not found" };
    }
    return { type: "unknown", parseable: false, reason: "unreadable" };
  }

  const type = detectType(absPath, bytes);
  if (!PARSEABLE.has(type)) {
    return { type, parseable: false, reason: "unsupported type" };
  }
  return { type, parseable: true };
}
```

`packages/docforge/src/index.ts`:

```ts
export type { DocType, ProbeResult } from "./types.ts";
export { detectType } from "./detect.ts";
export { probe } from "./probe.ts";
export { parse } from "./parse.ts";
export { truncateOutput } from "./truncate.ts";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run packages/docforge/tests`

Expected: PASS。若 html 断言 `/Hello/` 因库输出差异失败，只放宽为 `toContain("Hello")`，不要改夹具语义。

- [ ] **Step 5: Commit**

```bash
git add packages/docforge pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "feat: add docforge probe and parse for markdown and html"
```

---

### Task 2: PDF 解析（含空文本）

**Files:**
- Create: `packages/docforge/src/parsers/pdf.ts`
- Create: `packages/docforge/tests/helpers/pdf.ts`
- Modify: `packages/docforge/src/parse.ts`
- Modify: `packages/docforge/src/probe.ts`（PDF `pages`）
- Modify: `packages/docforge/package.json`（加 `unpdf`）
- Modify: `packages/docforge/tests/parse.test.ts`

**Interfaces:**
- Consumes: `unpdf.extractText` / `getDocumentProxy`；`detectType`
- Produces: `parsePdf(absPath): Promise<{ pages: number; markdown: string }>`。`parse` 输出 `## Page {n}`。抽空 → `failed: empty text`。probe 对 pdf 带 `pages`。

- [ ] **Step 1: Add failing PDF tests and a hello/empty fixture helper**

`packages/docforge/tests/helpers/pdf.ts`（若 unpdf 抽不出 `Hello`，只改这份 fixture 字节，禁止改用 canvas）：

```ts
/** One-page PDF with Helvetica text "Hello" and a valid xref. */
export const HELLO_PDF = Buffer.from(
  "JVBERi0xLjEKMSAwIG9iago8PC9UeXBlIC9DYXRhbG9nCi9QYWdlcyAyIDAgUgo+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlIC9QYWdlcwovS2lkcyBbMyAwIFJdCi9Db3VudCAxCj4+CmVuZG9iagozIDAgb2JqCjw8L1R5cGUgL1BhZ2UKL1BhcmVudCAyIDAgUgovUmVzb3VyY2VzIDw8L0ZvbnQgPDwvRjEgNCAwIFI+Pgo+PgovQ29udGVudHMgNSAwIFIKL01lZGlhQm94IFswIDAgNjEyIDc5Ml0KPj4KZW5kb2JqCjQgMCBvYmoKPDwvVHlwZSAvRm9udAovU3VidHlwZSAvVHlwZTEKL05hbWUgL0YxCi9CYXNlRm9udCAvSGVsdmV0aWNhCj4+CmVuZG9iago1IDAgb2JqCjw8L0xlbmd0aCA0ND4Kc3RyZWFtCkJUCi9GMSAyNCBUZgoxMDAgNzAwIFRkCihIZWxsbykgVGoKRVQKZW5kc3RyZWFtCmVuZG9iagp4cmVmCjAgNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA2MyAwMDAwMCBuIAowMDAwMDAwMTIxIDAwMDAwIG4gCjAwMDAwMDAyNTQgMDAwMDAgbiAKMDAwMDAwMDMzMiAwMDAwMCBuIAp0cmFpbGVyCjw8L1NpemUgNgovUm9vdCAxIDAgUgo+PgpzdGFydHhyZWYKNDI2CiUlRU9GCg==",
  "base64",
);

/** One-page PDF whose content stream is empty. */
export const EMPTY_PDF = Buffer.from(
  "JVBERi0xLjEKMSAwIG9iago8PC9UeXBlIC9DYXRhbG9nCi9QYWdlcyAyIDAgUgo+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlIC9QYWdlcwovS2lkcyBbMyAwIFJdCi9Db3VudCAxCj4+CmVuZG9iagozIDAgb2JqCjw8L1R5cGUgL1BhZ2UKL1BhcmVudCAyIDAgUgovTWVkaWFCb3ggWzAgMCA2MTIgNzkyXQovQ29udGVudHMgNCAwIFIKPj4KZW5kb2JqCjQgMCBvYmoKPDwvTGVuZ3RoIDA+CnN0cmVhbQplbmRzdHJlYW0KZW5kb2JqCnhyZWYKMCA1CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDYzIDAwMDAwIG4gCjAwMDAwMDAxMjEgMDAwMDAgbiAKMDAwMDAwMDIxNyAwMDAwMCBuIAp0cmFpbGVyCjw8L1NpemUgNQovUm9vdCAxIDAgUgo+PgpzdGFydHhyZWYKMjY1CiUlRU9GCg==",
  "base64",
);
```

在 `parse.test.ts` 追加：

```ts
import { writeFileSync } from "node:fs";
import { EMPTY_PDF, HELLO_PDF } from "./helpers/pdf.ts";

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
```

- [ ] **Step 2: Run the PDF test to verify it fails**

Run: `pnpm exec vitest run packages/docforge/tests/parse.test.ts`

Expected: FAIL（`failed: unreadable` 或没有 `pages`）。

- [ ] **Step 3: Implement PDF parser**

仓库根：`pnpm add unpdf --filter @flintloom/docforge`

`packages/docforge/src/parsers/pdf.ts`:

```ts
import { readFile } from "node:fs/promises";
import { extractText, getDocumentProxy } from "unpdf";

export async function parsePdf(
  absPath: string,
): Promise<{ pages: number; markdown: string }> {
  const bytes = new Uint8Array(await readFile(absPath));
  const pdf = await getDocumentProxy(bytes);
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [text];
  const markdown = pages
    .map((page, index) => `## Page ${index + 1}\n\n${page.trim()}`)
    .join("\n\n");
  return { pages: totalPages, markdown };
}
```

`parse.ts` 的 `switch` 增加：

```ts
case "pdf": {
  const pdf = await parsePdf(absPath);
  body = pdf.markdown;
  break;
}
```

`probe.ts` 在 `type === "pdf"` 且 parseable 时填 `pages`：调用 `parsePdf` 只为拿页数。若 `parsePdf` 抛错：`password|encrypt` → `{ type: "pdf", parseable: false, reason: "encrypted" }`，否则 `{ type: "pdf", parseable: false, reason: "unreadable" }`。

不要为 PDF 安装 `canvas`。

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run packages/docforge/tests`

Expected: PASS。若 hello PDF 字节不被 pdfjs 接受，修正 `tests/helpers/pdf.ts` 的字节（可改用带正确 xref 的最小 PDF），**不要**换库，除非 `unpdf` 在 Windows vitest 无法 import；那时才允许换成同等无 canvas 的 Node 文本库，断言不变。

- [ ] **Step 5: Commit**

```bash
git add packages/docforge pnpm-lock.yaml
git commit -m "feat: parse pdf pages to markdown via unpdf"
```

---

### Task 3: docx / xlsx / pptx

**Files:**
- Create: `packages/docforge/src/parsers/docx.ts`
- Create: `packages/docforge/src/parsers/xlsx.ts`
- Create: `packages/docforge/src/parsers/pptx.ts`
- Create: `packages/docforge/tests/helpers/office.ts`
- Modify: `packages/docforge/src/detect.ts`（无扩展名时 ZIP + `word/` `ppt/` `xl/`）
- Modify: `packages/docforge/src/parse.ts`
- Modify: `packages/docforge/src/probe.ts`（pptx `pages` = 幻灯数；xlsx `pages` = 可见表数）
- Modify: `packages/docforge/package.json`
- Modify: `packages/docforge/tests/parse.test.ts`
- Modify: `packages/docforge/tests/detect.test.ts`

**Interfaces:**
- Consumes: `mammoth.convertToMarkdown`、`exceljs.Workbook`、`jszip`
- Produces:

```ts
export async function parseDocx(absPath: string): Promise<string>;
export async function parseXlsx(
  absPath: string,
): Promise<{ pages: number; markdown: string }>;
export async function parsePptx(
  absPath: string,
): Promise<{ pages: number; markdown: string }>;
```

xlsx：每个**可见**表 `## {sheetName}` + markdown 表；空表只输出标题。pptx：只抽 `ppt/slides/slide*.xml` 的 `a:t`，`## Slide {n}`，不要 notes。docx：mammoth markdown，图片占位即可。

- [ ] **Step 1: Write office fixture helper and failing tests**

`packages/docforge/tests/helpers/office.ts`：

```ts
import { writeFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import JSZip from "jszip";

export async function writeHelloDocx(absPath: string): Promise<void> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p></w:body>
</w:document>`,
  );
  await writeFile(absPath, await zip.generateAsync({ type: "nodebuffer" }));
}

export async function writeHelloPptx(absPath: string): Promise<void> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`,
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Hello</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`,
  );
  await writeFile(absPath, await zip.generateAsync({ type: "nodebuffer" }));
}

export async function writeHelloXlsx(absPath: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  sheet.getCell("A1").value = "Hello";
  await workbook.xlsx.writeFile(absPath);
}
```

`parse.test.ts` 追加：

```ts
import {
  writeHelloDocx,
  writeHelloPptx,
  writeHelloXlsx,
} from "./helpers/office.ts";

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
```

`detect.test.ts` 追加 `mkdtempSync` / `tmpdir` / `writeHelloDocx` import，以及：

```ts
it("detects extensionless docx zip by parts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "flintloom-detect-"));
  const path = join(dir, "sample.docx");
  await writeHelloDocx(path);
  const bytes = readFileSync(path);
  expect(detectType(join(dir, "noext"), bytes)).toBe("docx");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run packages/docforge/tests`

Expected: FAIL。

- [ ] **Step 3: Install libs and implement parsers**

```bash
pnpm add mammoth exceljs jszip --filter @flintloom/docforge
```

`packages/docforge/src/parsers/docx.ts`：

```ts
import mammoth from "mammoth";

export async function parseDocx(absPath: string): Promise<string> {
  const { value } = await mammoth.convertToMarkdown({ path: absPath });
  return value;
}
```

`packages/docforge/src/parsers/xlsx.ts`：

```ts
import ExcelJS from "exceljs";

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "object" && "text" in value) {
    return String((value as { text: string }).text).replaceAll("|", "\\|");
  }
  return String(value).replaceAll("|", "\\|");
}

function rowsToTable(rows: string[][]): string {
  if (rows.length === 0) {
    return "";
  }
  const width = Math.max(...rows.map((row) => row.length), 1);
  const padded = rows.map((row) => {
    const next = [...row];
    while (next.length < width) next.push("");
    return next;
  });
  const header = padded[0];
  const sep = header.map(() => "---");
  return [
    `| ${header.join(" | ")} |`,
    `| ${sep.join(" | ")} |`,
    ...padded.slice(1).map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

export async function parseXlsx(
  absPath: string,
): Promise<{ pages: number; markdown: string }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(absPath);
  const sheets = workbook.worksheets.filter(
    (sheet) => sheet.state !== "hidden" && sheet.state !== "veryHidden",
  );
  const parts = sheets.map((sheet) => {
    const rows: string[][] = [];
    sheet.eachRow((row) => {
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      rows.push(values.map((cell) => cellText(cell as ExcelJS.CellValue)));
    });
    const table = rowsToTable(rows);
    return table.length > 0 ? `## ${sheet.name}\n\n${table}` : `## ${sheet.name}`;
  });
  return { pages: sheets.length, markdown: parts.join("\n\n") };
}
```

`packages/docforge/src/parsers/pptx.ts`：

```ts
import { readFile } from "node:fs/promises";
import JSZip from "jszip";

const SLIDE = /^ppt\/slides\/slide(\d+)\.xml$/;
const DRAWING_TEXT = /<a:t[^>]*>([^<]*)<\/a:t>/g;

export async function parsePptx(
  absPath: string,
): Promise<{ pages: number; markdown: string }> {
  const zip = await JSZip.loadAsync(await readFile(absPath));
  const slides = Object.keys(zip.files)
    .map((name) => {
      const match = SLIDE.exec(name);
      return match ? { name, n: Number(match[1]) } : undefined;
    })
    .filter((row): row is { name: string; n: number } => row !== undefined)
    .sort((a, b) => a.n - b.n);

  const parts: string[] = [];
  for (const slide of slides) {
    const xml = await zip.file(slide.name)!.async("string");
    const texts: string[] = [];
    for (const match of xml.matchAll(DRAWING_TEXT)) {
      texts.push(match[1]);
    }
    parts.push(`## Slide ${slide.n}\n\n${texts.join("\n")}`);
  }
  return { pages: slides.length, markdown: parts.join("\n\n") };
}
```

`detect.ts` 在扩展名未命中且以 `PK` 开头时，用同步字节扫描（保持 `detectType` 同步）：

```ts
function zipContains(bytes: Uint8Array, part: string): boolean {
  return Buffer.from(bytes).includes(part);
}

if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
  if (zipContains(bytes, "word/")) return "docx";
  if (zipContains(bytes, "ppt/")) return "pptx";
  if (zipContains(bytes, "xl/")) return "xlsx";
}
```

`parse.ts` switch 接上 `parseDocx` / `parsePptx` / `parseXlsx`。`probe.ts`：docx 无 pages；pptx/xlsx 调对应 parse 取 `pages`。加密/抛错映射与 PDF 相同。

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run packages/docforge/tests`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/docforge pnpm-lock.yaml
git commit -m "feat: parse docx pptx and xlsx into markdown"
```

---

### Task 4: 工具注册与 host

**Files:**
- Create: `packages/docforge/src/tools.ts`
- Create: `packages/docforge/tests/tools.test.ts`
- Modify: `packages/docforge/src/index.ts`
- Modify: `apps/host/package.json`
- Modify: `apps/host/src/server.ts`
- Modify: `apps/host/tests/server.test.ts`

**Interfaces:**
- Consumes: `resolveInside`、`WorkspaceEscapeError`、`probe`、`parse`、`ToolDefinition`
- Produces:

```ts
export function createDocProbeTool(): ToolDefinition; // name: "doc_probe"
export function createDocParseTool(): ToolDefinition; // name: "doc_parse"
```

工具 `execute`：缺 `path` → `failed: missing path`；已 abort → `aborted`；否则 `resolveInside` 后调纯函数。probe 成功时 `JSON.stringify` 键顺序为 `type`、`pages`（若有）、`parseable`、`reason`（若有）。

`doc_parse` description 必须含：对 pdf/docx/pptx/xlsx/html 使用本工具，不要用 `fs` 读二进制。

- [ ] **Step 1: Write failing tool and host tests**

`packages/docforge/tests/tools.test.ts`:

```ts
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WorkspaceEscapeError } from "@flintloom/tools";
import { createDocParseTool, createDocProbeTool } from "../src/tools.ts";

function createExec(workspaceRoot: string, signal = new AbortController().signal) {
  return { workspaceRoot, signal, channel: "cli" };
}

describe("doc tools", () => {
  it("probes and parses inside the workspace and rejects escape", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-doctool-"));
    writeFileSync(join(workspace, "README.md"), "# Hello\n");
    const exec = createExec(workspace);
    const probe = createDocProbeTool();
    const parse = createDocParseTool();

    expect(JSON.parse(await probe.execute({ path: "README.md" }, exec))).toEqual({
      type: "md",
      parseable: true,
    });
    expect(await parse.execute({ path: "README.md" }, exec)).toContain("Hello");
    expect(await parse.execute({}, exec)).toBe("failed: missing path");

    await expect(
      parse.execute({ path: "../x" }, exec),
    ).rejects.toThrow(WorkspaceEscapeError);
  });

  it("returns aborted when the signal is already aborted", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-doctool-"));
    const ac = new AbortController();
    ac.abort();
    const parse = createDocParseTool();
    expect(await parse.execute({ path: "README.md" }, createExec(workspace, ac.signal))).toBe(
      "aborted",
    );
  });
});
```

在 `apps/host/tests/server.test.ts` 追加：

```ts
it("registers doc_probe and doc_parse tools", () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-host-ws-"));
  const homeDir = mkdtempSync(join(tmpdir(), "flintloom-host-home-"));
  const runtime = createRuntime(workspaceRoot, homeDir);
  const names = runtime.tools.schemas().map((row) => row.name);
  expect(names).toContain("doc_probe");
  expect(names).toContain("doc_parse");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run packages/docforge/tests/tools.test.ts apps/host/tests/server.test.ts`

Expected: FAIL（tools 模块不存在或 schemas 不含新工具）。

- [ ] **Step 3: Implement tools and register on host**

`packages/docforge/src/tools.ts`：

```ts
import { resolveInside, type ToolDefinition } from "@flintloom/tools";
import { parse } from "./parse.ts";
import { probe } from "./probe.ts";
import type { ProbeResult } from "./types.ts";

function encodeProbe(result: ProbeResult): string {
  const ordered: Record<string, unknown> = { type: result.type };
  if (result.pages !== undefined) {
    ordered.pages = result.pages;
  }
  ordered.parseable = result.parseable;
  if (result.reason !== undefined) {
    ordered.reason = result.reason;
  }
  return JSON.stringify(ordered);
}

function pathArg(args: Record<string, unknown>): string | undefined {
  return typeof args.path === "string" && args.path.length > 0
    ? args.path
    : undefined;
}

export function createDocProbeTool(): ToolDefinition {
  return {
    name: "doc_probe",
    description:
      "Detect a workspace document type and whether it can be parsed. Use before doc_parse.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    async execute(args, exec) {
      if (exec.signal.aborted) {
        return "aborted";
      }
      const inputPath = pathArg(args);
      if (inputPath === undefined) {
        return "failed: missing path";
      }
      const absPath = resolveInside(exec.workspaceRoot, inputPath);
      return encodeProbe(await probe(absPath));
    },
  };
}

export function createDocParseTool(): ToolDefinition {
  return {
    name: "doc_parse",
    description:
      "Parse pdf, docx, pptx, xlsx, html, or markdown in the workspace into markdown. Do not use fs to read those binaries.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    async execute(args, exec) {
      if (exec.signal.aborted) {
        return "aborted";
      }
      const inputPath = pathArg(args);
      if (inputPath === undefined) {
        return "failed: missing path";
      }
      const absPath = resolveInside(exec.workspaceRoot, inputPath);
      return parse(absPath);
    },
  };
}
```

`index.ts` 增加：

```ts
export { createDocProbeTool, createDocParseTool } from "./tools.ts";
```

`apps/host/package.json` 的 `dependencies` 加 `"@flintloom/docforge": "workspace:*"`。

`apps/host/src/server.ts`：`import { createDocParseTool, createDocProbeTool } from "@flintloom/docforge";` 并在 `createShellTool()` 之后：

```ts
tools.register(createDocProbeTool());
tools.register(createDocParseTool());
```

仓库根：`pnpm install`

- [ ] **Step 4: Run the full suite**

Run: `pnpm test`

Expected: 全部 PASS（含原 host/loop/fs/grep/shell/desktop）。再跑 `pnpm typecheck`，Expected: exit 0。

- [ ] **Step 5: Commit**

```bash
git add packages/docforge apps/host/src/server.ts apps/host/package.json apps/host/tests/server.test.ts pnpm-lock.yaml
git commit -m "feat: register doc_probe and doc_parse on the host"
```

---

## Spec coverage

| Spec | Task |
|---|---|
| `detectType` 扩展名优先、无扩展名走魔数、`.doc` unknown | 1、3 |
| probe JSON；not found / unknown | 1 |
| parse md BOM、html、截断 200000 | 1 |
| pdf `## Page N`、empty text、pages | 2 |
| docx/xlsx/pptx Hello、pptx/xlsx pages、可见表 | 3 |
| ZIP 无扩展名 | 3 |
| 工具 resolveInside、missing path、aborted、描述 | 4 |
| host schemas 含两工具 | 4 |
| 不改 runTurn / 不做预览与知识库 | 全任务（禁止改那些文件） |
| 加密映射 | 2、3 的 catch（无强制加密夹具；错误消息匹配即可） |
