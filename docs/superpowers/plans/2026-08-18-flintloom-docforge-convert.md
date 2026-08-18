# FlintLoom DocForge convert Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agent 能对工作区已有文档调用 `doc_convert({ source, out })`，把可 parse 的六种源写成 md / html / docx / pdf，成功 JSON 带固定 `from` / `loss`；parse 失败则原样 `failed:` 且不写 `out`。

**Architecture:** 纯函数在 `@flintloom/docforge`：`detectType(path, bytes)` → `parse` → `buildDocument` → 一次 `writeFile`。不新写 pdf/docx writer，不落中间 `.md`。工具 `createDocConvertTool` 做与 generate 相同的路径闸门后调用纯函数，经现有 `apply` 登记在 parse 与 generate 之间。yml 不新加插件。不改 host 组装、不改 preview `kind`、不 mkdir。

**Tech Stack:** 现有 `parse`、`buildDocument`、`formatFromOutRelPath`、`GENERATE_MAX_BYTES` / `GENERATE_MAX_CHARS`、包内 Noto Sans SC。不新增 npm 依赖。禁止 pandoc / Chrome / LibreOffice。

## Global Constraints

- 产品名 FlintLoom；包前缀 `@flintloom/*`；只绑 `127.0.0.1`。
- 不 import / submodule / 拷贝 dataagent-v3、deepseek-harness、Cordis。
- 禁止往 `createRuntime` 里 `register`。`apps/host/src` 不得出现 `createDocConvertTool`；不要用正则禁止单词 `convert`。
- `packages/loop/src`、`packages/session/src`、`apps/desktop/src` 不得出现 `convertDocument` / `lossForConvert`。
- `detectType(path, bytes)` 两参数；先 `stat.size > GENERATE_MAX_BYTES` 再 `readFile`。禁止单参 `detectType(path)`。
- 复用 generate writer：PDF `text()` 嵌包内字体；docx **不**嵌入 ODTTF。不 mkdir。
- `failed:` 理由只允许：`missing source` / `missing out` / `hidden` / `not found` / `not a file` / `bad out` / `missing parent` / `too large` / `unreadable` / `empty text` / `encrypted` / `unsupported type`。本片没有 `failed: bad source`。
- parse 失败判定：`parse` 返回值**整串等于** `failed: empty text` / `failed: encrypted` / `failed: unsupported type` / `failed: not found` / `failed: unreadable`。不要 `startsWith("failed: ")`。
- Windows 提交指定文件；不要 `git add -A`。不要提交 `check_libs.py`、`scripts/desktop-dev.ts`（除非本任务改了它们——本计划不改）。

Spec：`docs/superpowers/specs/2026-08-18-flintloom-docforge-convert-design.md`

## File map

```text
packages/docforge/src/convert.ts        # ConvertFrom, lossForConvert, convertDocument
packages/docforge/src/tools.ts          # FAIL_REASONS + createDocConvertTool
packages/docforge/src/index.ts          # 导出 + apply 在 parse 与 generate 之间登记
packages/docforge/tests/convert.test.ts # 纯函数验收
packages/docforge/tests/tools.test.ts   # 工具闸门 + 成功 JSON
packages/docforge/tests/plugin.test.ts  # schemas 含 doc_convert；stop() 撤销
apps/host/tests/server.test.ts          # factory 扫描 + yml 去掉 docforge
```

不改 `files.ts` preview、`writers/*`、字体、yml 插件表、loop / session / desktop。

---

### Task 1: lossForConvert + convertDocument

**Files:**
- Create: `packages/docforge/src/convert.ts`
- Create: `packages/docforge/tests/convert.test.ts`
- Modify: `packages/docforge/src/index.ts`（导出新符号；本任务还不登记工具）

**Interfaces:**
- Consumes: `parse`、`detectType`、`buildDocument`、`formatFromOutRelPath`、`GENERATE_MAX_BYTES`、`GENERATE_MAX_CHARS`、`GenerateFormat`
- Produces:

```ts
export type ConvertFrom = "md" | "html" | "pdf" | "docx" | "pptx" | "xlsx";

export function lossForConvert(from: ConvertFrom, format: GenerateFormat): string;

export async function convertDocument(
  absSource: string,
  absOut: string,
): Promise<{ from: ConvertFrom; format: GenerateFormat; loss: string }>;
```

`lossForConvert` 固定英文：

| `from` | `format` | 返回值 |
|---|---|---|
| `md` | `md` | `none` |
| `md` | html / docx / pdf | `images skipped; emphasis flattened` |
| `html` | 任一合法目标 | `scripts and layout discarded` |
| `pdf` | 任一合法目标 | `images and layout discarded; text only` |
| `docx` | 任一合法目标 | `images and complex formatting discarded` |
| `pptx` | 任一合法目标 | `notes and images discarded; slide text only` |
| `xlsx` | 任一合法目标 | `formulas charts and formatting discarded; tables as text` |

- [ ] **Step 1: 写失败测试**

`packages/docforge/tests/convert.test.ts`：

```ts
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "../src/parse.ts";
import { GENERATE_MAX_BYTES } from "../src/generate.ts";
import { convertDocument, lossForConvert } from "../src/convert.ts";
import { EMPTY_PDF, HELLO_PDF } from "./helpers/pdf.ts";
import { writeHelloDocx, writeHelloXlsx } from "./helpers/office.ts";

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

  it("rejects xlsx out as bad out", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-cv-badout-"));
    const source = join(dir, "hello.md");
    writeFileSync(source, "# Hello\n");
    await expect(convertDocument(source, join(dir, "out.xlsx"))).rejects.toThrow(
      /bad out/,
    );
  });

  it("empty pdf is empty text and does not write out", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-cv-empty-"));
    const source = join(dir, "empty.pdf");
    const out = join(dir, "out.md");
    writeFileSync(source, EMPTY_PDF);
    await expect(convertDocument(source, out)).rejects.toThrow(/empty text/);
    expect(existsSync(out)).toBe(false);
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run packages/docforge/tests/convert.test.ts`

Expected: FAIL（`convert.ts` 不存在 / `lossForConvert` 未导出）

- [ ] **Step 3: 写最小实现**

`packages/docforge/src/convert.ts`：

```ts
import { readFile, stat, writeFile } from "node:fs/promises";
import { detectType } from "./detect.ts";
import {
  GENERATE_MAX_BYTES,
  GENERATE_MAX_CHARS,
  buildDocument,
  formatFromOutRelPath,
  type GenerateFormat,
} from "./generate.ts";
import { parse } from "./parse.ts";
import type { DocType } from "./types.ts";

export type ConvertFrom = "md" | "html" | "pdf" | "docx" | "pptx" | "xlsx";

const PARSE_FAIL_REASONS = new Set([
  "empty text",
  "encrypted",
  "unsupported type",
  "not found",
  "unreadable",
]);

function isConvertFrom(type: DocType): type is ConvertFrom {
  return type !== "unknown";
}

function ioCode(err: unknown): string {
  return typeof err === "object" && err !== null && "code" in err
    ? (err as { code: string }).code
    : "";
}

export function lossForConvert(from: ConvertFrom, format: GenerateFormat): string {
  if (from === "md") {
    return format === "md" ? "none" : "images skipped; emphasis flattened";
  }
  switch (from) {
    case "html":
      return "scripts and layout discarded";
    case "pdf":
      return "images and layout discarded; text only";
    case "docx":
      return "images and complex formatting discarded";
    case "pptx":
      return "notes and images discarded; slide text only";
    case "xlsx":
      return "formulas charts and formatting discarded; tables as text";
  }
}

export async function convertDocument(
  absSource: string,
  absOut: string,
): Promise<{ from: ConvertFrom; format: GenerateFormat; loss: string }> {
  const format = formatFromOutRelPath(absOut);
  if (format === undefined) {
    throw new Error("bad out");
  }
  let st;
  try {
    st = await stat(absSource);
  } catch (err) {
    if (ioCode(err) === "ENOENT") {
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
  const detected = detectType(absSource, bytes);
  if (!isConvertFrom(detected)) {
    throw new Error("unsupported type");
  }
  const markdown = await parse(absSource);
  for (const reason of PARSE_FAIL_REASONS) {
    if (markdown === `failed: ${reason}`) {
      throw new Error(reason);
    }
  }
  if (markdown.length > GENERATE_MAX_CHARS) {
    throw new Error("too large");
  }
  const payload = await buildDocument(format, markdown);
  await writeFile(absOut, payload);
  return {
    from: detected,
    format,
    loss: lossForConvert(detected, format),
  };
}
```

`packages/docforge/src/index.ts` 增加导出（不要在本任务改 `apply`）：

```ts
export type { ConvertFrom } from "./convert.ts";
export { convertDocument, lossForConvert } from "./convert.ts";
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run packages/docforge/tests/convert.test.ts packages/docforge/tests/generate.test.ts packages/docforge/tests/parse.test.ts`

Expected: PASS。若 `hello.md` → pdf 抽不到「发展」，不要改 pdf writer；先确认源夹具仍含该字，再查是否误把截断 markdown 交给了 `buildDocument`。

- [ ] **Step 5: Commit**

```bash
git add packages/docforge/src/convert.ts packages/docforge/src/index.ts packages/docforge/tests/convert.test.ts
git commit -m "feat: convert workspace documents through parse and generate writers"
```

---

### Task 2: doc_convert 工具 + apply

**Files:**
- Modify: `packages/docforge/src/tools.ts`
- Modify: `packages/docforge/src/index.ts`
- Modify: `packages/docforge/tests/tools.test.ts`
- Modify: `packages/docforge/tests/plugin.test.ts`

**Interfaces:**
- Consumes: `convertDocument`、`formatFromOutRelPath`、`GENERATE_MAX_BYTES`
- Produces: `createDocConvertTool(): ToolDefinition`；`apply` 在 `createDocParseTool` 之后、`createDocGenerateTool` 之前 `register`

成功 JSON 键顺序：`status`、`source`、`out`、`from`、`format`、`loss`。`source`/`out` 为工作区相对路径，`\` → `/`。

检查顺序必须与 spec §5.2 一致：abort → missing source → missing out → `resolveInside` → hidden → `bad out` → source stat / not found / not a file / too large → missing parent → out not-a-file → `convertDocument`。

- [ ] **Step 1: 写失败测试**

`tools.test.ts`：把现有 `node:fs` import 改成包含 `existsSync`（保留 `mkdtempSync`、`readFileSync`、`writeFileSync`）。从 `../src/tools.ts` 的 named import 增加 `createDocConvertTool`。再增加：

```ts
import { EMPTY_PDF } from "./helpers/pdf.ts";
import { writeHelloDocx } from "./helpers/office.ts";
```

```ts
it("converts docx to md with ordered json", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "flintloom-ctool-ok-"));
  await writeHelloDocx(join(workspace, "sample.docx"));
  const tool = createDocConvertTool();
  const exec = createExec(workspace);
  const raw = await tool.execute({ source: "sample.docx", out: "out.md" }, exec);
  expect(Object.keys(JSON.parse(raw))).toEqual([
    "status",
    "source",
    "out",
    "from",
    "format",
    "loss",
  ]);
  expect(JSON.parse(raw)).toEqual({
    status: "ok",
    source: "sample.docx",
    out: "out.md",
    from: "docx",
    format: "md",
    loss: "images and complex formatting discarded",
  });
});

it("maps convert failures without writing out", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "flintloom-ctool-"));
  writeFileSync(join(workspace, "hello.md"), "# Hello\n");
  writeFileSync(join(workspace, "empty.pdf"), EMPTY_PDF);
  const tool = createDocConvertTool();
  const exec = createExec(workspace);

  expect(await tool.execute({ out: "a.pdf" }, exec)).toBe("failed: missing source");
  expect(await tool.execute({ source: "hello.md" }, exec)).toBe("failed: missing out");
  expect(await tool.execute({ source: "hello.md", out: "a.xlsx" }, exec)).toBe(
    "failed: bad out",
  );
  expect(await tool.execute({ source: "nope.md", out: "a.pdf" }, exec)).toBe(
    "failed: not found",
  );
  expect(await tool.execute({ source: "hello.md", out: "missing/a.pdf" }, exec)).toBe(
    "failed: missing parent",
  );
  expect(existsSync(join(workspace, "missing"))).toBe(false);
  expect(await tool.execute({ source: ".env", out: "a.md" }, exec)).toBe("failed: hidden");
  await expect(tool.execute({ source: "../x.md", out: "a.md" }, exec)).rejects.toThrow(
    WorkspaceEscapeError,
  );
  expect(await tool.execute({ source: "empty.pdf", out: "from-empty.md" }, exec)).toBe(
    "failed: empty text",
  );
  expect(existsSync(join(workspace, "from-empty.md"))).toBe(false);

  writeFileSync(join(workspace, "old.md"), "OLD\n");
  expect(JSON.parse(await tool.execute({ source: "hello.md", out: "old.md" }, exec)).status).toBe(
    "ok",
  );
  expect(readFileSync(join(workspace, "old.md"), "utf8")).toContain("Hello");
});

it("returns aborted when the convert signal is aborted", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "flintloom-ctool-ab-"));
  const ac = new AbortController();
  ac.abort();
  const tool = createDocConvertTool();
  expect(
    await tool.execute({ source: "a.md", out: "a.pdf" }, createExec(workspace, ac.signal)),
  ).toBe("aborted");
});
```

`plugin.test.ts`：现有 `registers doc_probe...` 用例增加 `toContain("doc_convert")`。再增加：

```ts
it("registers doc_convert and drops it on stop", () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), "flintloom-docforge-kb-")), "k.sqlite");
  const ctx = new Context();
  ctx.plugin(modelsPlugin);
  ctx.plugin(toolsPlugin);
  ctx.plugin(knowledgePlugin, { dbPath });
  const stop = ctx.plugin(plugin);
  const names = ctx.require<ToolRegistry>("tools").schemas().map((s) => s.name);
  expect(names).toContain("doc_convert");
  stop();
  expect(ctx.require<ToolRegistry>("tools").schemas().map((s) => s.name)).not.toContain(
    "doc_convert",
  );
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run packages/docforge/tests/tools.test.ts packages/docforge/tests/plugin.test.ts`

Expected: FAIL（`createDocConvertTool` 未导出）

- [ ] **Step 3: 实现工具**

`tools.ts`：`FAIL_REASONS` 增加 `"empty text"`、`"encrypted"`、`"unsupported type"`（保留 `"bad source"`，generate 仍需要）。增加 import：

```ts
import { convertDocument } from "./convert.ts";
```

在 `createDocGenerateTool` **之后**追加（文件内顺序任意；`apply` 登记顺序才算数）：

```ts
export function createDocConvertTool(): ToolDefinition {
  return {
    name: "doc_convert",
    description:
      "Convert a workspace document (md, html, pdf, docx, pptx, or xlsx) to md, html, docx, or pdf. Pass source and out; format is the out extension. pptx and xlsx cannot be out. Do not use this to generate from scratch; write markdown first or use doc_generate for md sources if you prefer.",
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
        const result = await convertDocument(absSource, absOut);
        return JSON.stringify({
          status: "ok",
          source: sourceRel,
          out: outRel,
          from: result.from,
          format: result.format,
          loss: result.loss,
        });
      } catch (err) {
        return failFromError(err);
      }
    },
  };
}
```

`format` 局部变量在闸门里用于 `bad out`；成功 JSON 的 `format` 必须用 `result.format`。不要把 `format` 漏进 JSON 导致键顺序或值不一致。

`index.ts`：

```ts
import {
  createDocConvertTool,
  createDocGenerateTool,
  createDocIngestTool,
  createDocParseTool,
  createDocProbeTool,
} from "./tools.ts";

export {
  createDocProbeTool,
  createDocParseTool,
  createDocConvertTool,
  createDocGenerateTool,
  createDocIngestTool,
};

const plugin: FlintPlugin = {
  name: "@flintloom/docforge",
  apply(ctx: Context) {
    const tools = ctx.require<ToolRegistry>("tools");
    const kb = ctx.require<KnowledgeService>("knowledge");
    ctx.effect(tools.register(createDocProbeTool()));
    ctx.effect(tools.register(createDocParseTool()));
    ctx.effect(tools.register(createDocConvertTool()));
    ctx.effect(tools.register(createDocGenerateTool()));
    ctx.effect(tools.register(createDocIngestTool(kb)));
  },
};
```

保留 Task 1 已加的 `convertDocument` / `lossForConvert` / `ConvertFrom` 导出。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run packages/docforge/tests/tools.test.ts packages/docforge/tests/plugin.test.ts packages/docforge/tests/convert.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/docforge/src/tools.ts packages/docforge/src/index.ts packages/docforge/tests/tools.test.ts packages/docforge/tests/plugin.test.ts
git commit -m "feat: register doc_convert on the docforge plugin"
```

---

### Task 3: host factory 扫描 + 去掉 docforge + 全量验收

**Files:**
- Modify: `apps/host/tests/server.test.ts`

**Interfaces:**
- Consumes: Task 2 的工具名 `doc_convert`
- Produces: host `src` 不含 `createDocConvertTool`；yml 无 docforge 行则 schema 无该工具

本任务**只改测试**。不要改 `apps/host/src`。负向断言在实现前也可能是绿的；价值是锁住「host 不 import 工厂」，并以 `pnpm test` 做全量验收。

- [ ] **Step 1: 写测试**

在 `host src does not import tool factories` 增加（放在 `createDocGenerateTool` 那一行旁边）：

```ts
expect(src).not.toMatch(/createDocConvertTool/);
```

不要写 `/convert/` 这类会误伤注释的正则。

现有 `omitting docforge from yml omits doc_generate` 增加：

```ts
expect(names).not.toContain("doc_convert");
```

- [ ] **Step 2: 跑 host 测试**

Run: `pnpm exec vitest run apps/host/tests/server.test.ts`

Expected: PASS（yml 去掉 docforge 后本来就没有这些工具；若 ASSEMBLY replace 失败导致仍加载 docforge，则 `not.toContain("doc_generate")` 会先红——修 replace 字符串，使其与 `apps/host/tests/assembly.ts` 完全一致）。

- [ ] **Step 3: 确认 host / loop / session / desktop 源码无泄漏**

不要改那些目录。若 Step 4 全量测试以外需要人工确认，在 `apps/host/src`、`packages/loop/src`、`packages/session/src`、`apps/desktop/src` 搜索 `createDocConvertTool`、`convertDocument`、`lossForConvert`，结果必须为空。`apps/host/src/files.ts` 继续只 import `detectType` / `parse`。

- [ ] **Step 4: 全量测试**

Run: `pnpm test`

Expected: 全部 PASS（含现有 generate / parse / ingest / 预览 / 信息图 / A2UI）。不打真实 DashScope。

- [ ] **Step 5: Commit**

```bash
git add apps/host/tests/server.test.ts
git commit -m "test: omit docforge drops doc_convert"
```

---

## Spec coverage

| Spec | Task |
|---|---|
| `lossForConvert` 七行固定英文；html/docx/xlsx 不叠第二句 | 1 |
| `detectType(path, bytes)` 两参数；非六种 → `unsupported type` | 1 |
| `parse` → `buildDocument` → 一次 `writeFile`；不落中间 `.md` | 1 |
| md 源允许；md→md `loss: none` 且保留图片语法 | 1 |
| `hello.md` → pdf，`parse` 含 Hello / 发展 | 1 |
| docx→md / pdf→html / xlsx→md | 1 |
| empty pdf → `empty text`，不写 out | 1 |
| 字节 / 字符上限；截断 markdown 不交给 writer | 1 |
| 目录 source → `unreadable`，已有 out 不变 | 1 |
| parse 失败整串相等；`failed: empty text\n# Hello` 仍转换 | 1 |
| `.xlsx` out → `bad out` | 1–2 |
| 工具检查顺序、hidden、`../outside`、缺 source 先于缺 out、覆盖、missing parent | 2 |
| 成功 JSON 键顺序 `status,source,out,from,format,loss` | 2 |
| `apply` 在 parse 与 generate 之间登记；`stop()` 撤销 | 2 |
| `FAIL_REASONS` 含 parse 三词；无 `bad source` 作为 convert 结果 | 2 |
| host 不 import 工厂；yml 去掉 docforge | 3 |
| 不改 preview kind / A2UI / loop / 不 mkdir / 不写 xlsx 目标 | 全任务都不碰那些文件 |
