# FlintLoom DocForge compare Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agent 能对两份工作区文档调用 `doc_compare({ a, b })`，先 parse 成 markdown 再做行级 unified diff；相同则 `identical: true` 且 `diff` 为空串；不写盘。

**Architecture:** 从 `parse.ts` 抽出 `parseToMarkdown`（判别联合，无 empty/截断）。`compareDocuments` 对两边 `stat` → parse → `normalizeMarkdown` → 全等或 `createTwoFilesPatch`。`createDocCompareTool` 走 convert 同款双路径闸门，经现有 `apply` 登记在 edit 与 ingest 之间。yml 不新加插件。不改 host 组装、不改 preview `kind`、不写文件。

**Tech Stack:** 现有 `detectType`、`normalizeMarkdown`、`GENERATE_MAX_BYTES` / `GENERATE_MAX_CHARS`。新增 `diff` ^8（jsdiff，自带类型）。禁止用 `startsWith("failed: ")` 判断 parse 成败。禁止系统 `git diff`。

## Global Constraints

- 产品名 FlintLoom；包前缀 `@flintloom/*`；只绑 `127.0.0.1`。
- 不 import / submodule / 拷贝 dataagent-v3、deepseek-harness、Cordis。
- 禁止往 `createRuntime` 里 `register`。`apps/host/src` 不得出现 `createDocCompareTool`。不要用正则禁止单词 `compare`。
- `packages/loop/src`、`packages/session/src`、`apps/desktop/src` 不得出现 `compareDocuments` 或 `parseToMarkdown`。
- `detectType(path, bytes)` 两参数；先 `stat.size > GENERATE_MAX_BYTES` 再读/parse。禁止单参 `detectType(path)`。
- 匹配：parse 后的 markdown；`normalizeMarkdown`（去 BOM；`\r\n` / `\r` → `\n`）；不 `copyMarkdown`。
- 相同则不调用 patch 库。`diff.createTwoFilesPatch(aRel, bRel, aMd, bMd, undefined, undefined, { context: 3 })`。头是工作区相对路径，不用 git `a/` `b/` 前缀。
- `failed:` 理由只允许：`missing a` / `missing b` / `hidden` / `not found` / `not a file` / `too large` / `unsupported type` / `encrypted` / `unreadable`。没有 `empty text` / `missing path` / `bad source`。
- 不写盘。空正文可以比。缺 a 先于缺 b。闸门先 a 后 b。
- Windows 提交指定文件；不要 `git add -A`。不要提交 `check_libs.py`、`scripts/desktop-dev.ts`。

Spec：`docs/superpowers/specs/2026-08-19-flintloom-docforge-compare-design.md`

## File map

```text
packages/docforge/package.json              # 加 diff ^8
pnpm-lock.yaml
packages/docforge/src/parse.ts              # parseToMarkdown + parse() 包装
packages/docforge/src/compare.ts            # compareDocuments
packages/docforge/src/tools.ts              # FAIL_REASONS + createDocCompareTool
packages/docforge/src/index.ts              # 导出 + apply 在 edit 与 ingest 之间登记
packages/docforge/tests/compare.test.ts     # 纯函数验收（含 parse 回归）
packages/docforge/tests/tools.test.ts       # 工具闸门 + 成功 JSON
packages/docforge/tests/plugin.test.ts      # schemas 含 doc_compare；stop() 撤销
apps/host/tests/server.test.ts              # factory 扫描 + yml 去掉 docforge
```

不改 `files.ts` preview、`writers/*`、yml 插件表、loop / session / desktop。`files.ts` 仍可 import `parse` / `probe`。

---

### Task 1: parseToMarkdown + compareDocuments

**Files:**
- Create: `packages/docforge/src/compare.ts`
- Create: `packages/docforge/tests/compare.test.ts`
- Modify: `packages/docforge/src/parse.ts`
- Modify: `packages/docforge/src/index.ts`（导出；本任务还不登记工具）
- Modify: `packages/docforge/package.json`、根目录 `pnpm-lock.yaml`（`diff` ^8）

**Interfaces:**
- Consumes: `detectType`、`normalizeMarkdown`、`GENERATE_MAX_BYTES`、`GENERATE_MAX_CHARS`、现有六种 parser、`createTwoFilesPatch`
- Produces:

```ts
export type ParseMarkdownResult =
  | { ok: true; markdown: string }
  | {
      ok: false;
      reason: "not found" | "unreadable" | "unsupported type" | "encrypted";
    };

export async function parseToMarkdown(
  absPath: string,
): Promise<ParseMarkdownResult>;

export async function compareDocuments(
  absA: string,
  absB: string,
  aRel: string,
  bRel: string,
): Promise<{ identical: boolean; diff: string }>;
```

- [ ] **Step 1: 写失败测试**

`packages/docforge/tests/compare.test.ts`：

```ts
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GENERATE_MAX_BYTES, GENERATE_MAX_CHARS } from "../src/generate.ts";
import { compareDocuments } from "../src/compare.ts";
import { parse, parseToMarkdown } from "../src/parse.ts";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const helloMd = readFileSync(join(fixtures, "hello.md"), "utf8");

describe("parseToMarkdown", () => {
  it("allows empty markdown that parse still rejects", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-cmp-empty-"));
    const path = join(dir, "empty.md");
    writeFileSync(path, "");
    await expect(parseToMarkdown(path)).resolves.toEqual({
      ok: true,
      markdown: "",
    });
    expect(await parse(path)).toBe("failed: empty text");
  });

  it("does not treat a failed: prefix body as an error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-cmp-prefix-"));
    const path = join(dir, "tricky.md");
    writeFileSync(path, "failed: empty text\n# Hello\n");
    const parsed = await parseToMarkdown(path);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.markdown).toContain("# Hello");
    }
    expect(await parse(path)).toContain("# Hello");
  });
});

describe("compareDocuments", () => {
  it("diffs Hello to Hi and keeps 发展 in context", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-cmp-ok-"));
    const a = join(dir, "hello.md");
    const b = join(dir, "hi.md");
    writeFileSync(a, helloMd);
    writeFileSync(b, helloMd.replace("# Hello", "# Hi"));
    const result = await compareDocuments(a, b, "hello.md", "hi.md");
    expect(result.identical).toBe(false);
    expect(result.diff).toContain("-# Hello");
    expect(result.diff).toContain("+# Hi");
    expect(result.diff).toContain("发展");
    expect(result.diff).toContain("--- hello.md");
    expect(result.diff).toContain("+++ hi.md");
    expect(result.diff).not.toMatch(/^--- a\//m);
  });

  it("returns identical true for the same file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-cmp-same-"));
    const a = join(dir, "hello.md");
    writeFileSync(a, helloMd);
    await expect(compareDocuments(a, a, "hello.md", "hello.md")).resolves.toEqual({
      identical: true,
      diff: "",
    });
  });

  it("treats two empty markdown files as identical", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-cmp-empties-"));
    const a = join(dir, "a.md");
    const b = join(dir, "b.md");
    writeFileSync(a, "");
    writeFileSync(b, "");
    await expect(compareDocuments(a, b, "a.md", "b.md")).resolves.toEqual({
      identical: true,
      diff: "",
    });
  });

  it("treats CRLF and LF of the same text as identical", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-cmp-crlf-"));
    const a = join(dir, "lf.md");
    const b = join(dir, "crlf.md");
    writeFileSync(a, "# Hello\n发展\n");
    writeFileSync(b, "# Hello\r\n发展\r\n");
    await expect(compareDocuments(a, b, "lf.md", "crlf.md")).resolves.toEqual({
      identical: true,
      diff: "",
    });
  });

  it("rejects unknown binaries", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-cmp-bin-"));
    const a = join(dir, "a.md");
    const b = join(dir, "x.bin");
    writeFileSync(a, "# Hello\n");
    writeFileSync(b, readFileSync(join(fixtures, "binary.bin")));
    await expect(compareDocuments(a, b, "a.md", "x.bin")).rejects.toThrow(
      /unsupported type/,
    );
  });

  it("rejects files over the byte limit before reading", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-cmp-bytes-"));
    const a = join(dir, "huge.md");
    const b = join(dir, "ok.md");
    writeFileSync(a, Buffer.alloc(GENERATE_MAX_BYTES + 1, 0x61));
    writeFileSync(b, "# Hello\n");
    await expect(compareDocuments(a, b, "huge.md", "ok.md")).rejects.toThrow(
      /too large/,
    );
  });

  it("rejects markdown over the char limit after normalize", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-cmp-chars-"));
    const a = join(dir, "huge.md");
    const b = join(dir, "ok.md");
    writeFileSync(a, "x".repeat(GENERATE_MAX_CHARS + 1));
    writeFileSync(b, "# Hello\n");
    await expect(compareDocuments(a, b, "huge.md", "ok.md")).rejects.toThrow(
      /too large/,
    );
  });

  it("rejects a patch that exceeds GENERATE_MAX_CHARS", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-cmp-patch-"));
    const a = join(dir, "a.md");
    const b = join(dir, "b.md");
    writeFileSync(a, `${"a".repeat(180_000)}\n`);
    writeFileSync(b, `${"b".repeat(180_000)}\n`);
    await expect(compareDocuments(a, b, "a.md", "b.md")).rejects.toThrow(
      /too large/,
    );
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run packages/docforge/tests/compare.test.ts`

Expected: FAIL（`compare.ts` 不存在或 `parseToMarkdown` 未导出）

- [ ] **Step 3: 加依赖并写最小实现**

从仓库根目录：

```bash
pnpm add diff@^8 --filter @flintloom/docforge
```

不要加 `@types/diff`。

把 `packages/docforge/src/parse.ts` 改成：

```ts
import { readFile } from "node:fs/promises";
import { detectType } from "./detect.ts";
import { parseDocx } from "./parsers/docx.ts";
import { parseHtml } from "./parsers/html.ts";
import { parseMd } from "./parsers/md.ts";
import { parsePdf } from "./parsers/pdf.ts";
import { parsePptx } from "./parsers/pptx.ts";
import { parseXlsx } from "./parsers/xlsx.ts";
import { truncateOutput } from "./truncate.ts";

export type ParseMarkdownResult =
  | { ok: true; markdown: string }
  | {
      ok: false;
      reason: "not found" | "unreadable" | "unsupported type" | "encrypted";
    };

function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "ENOENT"
  );
}

export async function parseToMarkdown(
  absPath: string,
): Promise<ParseMarkdownResult> {
  let bytes: Buffer;
  try {
    bytes = await readFile(absPath);
  } catch (err) {
    if (isNotFound(err)) {
      return { ok: false, reason: "not found" };
    }
    return { ok: false, reason: "unreadable" };
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
      case "pdf": {
        const pdf = await parsePdf(absPath);
        body = pdf.markdown;
        break;
      }
      case "docx":
        body = await parseDocx(absPath);
        break;
      case "pptx": {
        const pptx = await parsePptx(absPath);
        body = pptx.markdown;
        break;
      }
      case "xlsx": {
        const xlsx = await parseXlsx(absPath);
        body = xlsx.markdown;
        break;
      }
      case "unknown":
        return { ok: false, reason: "unsupported type" };
      default:
        return { ok: false, reason: "unreadable" };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/password|encrypt/i.test(message)) {
      return { ok: false, reason: "encrypted" };
    }
    return { ok: false, reason: "unreadable" };
  }
  return { ok: true, markdown: body };
}

export async function parse(absPath: string): Promise<string> {
  const result = await parseToMarkdown(absPath);
  if (!result.ok) {
    return `failed: ${result.reason}`;
  }
  const trimmed = result.markdown.replace(/\s+/g, " ").trim();
  if (trimmed.length === 0) {
    return "failed: empty text";
  }
  return truncateOutput(result.markdown);
}
```

禁止在 `parse()` 里用 `result.markdown.startsWith("failed: ")`。

`packages/docforge/src/compare.ts`：

```ts
import { stat } from "node:fs/promises";
import { createTwoFilesPatch } from "diff";
import { normalizeMarkdown } from "./edit.ts";
import {
  GENERATE_MAX_BYTES,
  GENERATE_MAX_CHARS,
} from "./generate.ts";
import { parseToMarkdown } from "./parse.ts";

function ioCode(err: unknown): string {
  return typeof err === "object" && err !== null && "code" in err
    ? (err as { code: string }).code
    : "";
}

async function loadSide(absPath: string): Promise<string> {
  let st;
  try {
    st = await stat(absPath);
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
  const parsed = await parseToMarkdown(absPath);
  if (!parsed.ok) {
    throw new Error(parsed.reason);
  }
  const body = normalizeMarkdown(parsed.markdown);
  if (body.length > GENERATE_MAX_CHARS) {
    throw new Error("too large");
  }
  return body;
}

export async function compareDocuments(
  absA: string,
  absB: string,
  aRel: string,
  bRel: string,
): Promise<{ identical: boolean; diff: string }> {
  const aMd = await loadSide(absA);
  const bMd = await loadSide(absB);
  if (aMd === bMd) {
    return { identical: true, diff: "" };
  }
  const diffText = createTwoFilesPatch(
    aRel,
    bRel,
    aMd,
    bMd,
    undefined,
    undefined,
    { context: 3 },
  );
  if (diffText.length > GENERATE_MAX_CHARS) {
    throw new Error("too large");
  }
  return { identical: false, diff: diffText };
}
```

`packages/docforge/src/index.ts` 在现有 `export { parse }` 处改为（不要在本任务改 `apply`）：

```ts
export type { ParseMarkdownResult } from "./parse.ts";
export { parse, parseToMarkdown } from "./parse.ts";
export { compareDocuments } from "./compare.ts";
```

删掉原来的单独 `export { parse } from "./parse.ts";`，避免重复导出。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run packages/docforge/tests/compare.test.ts packages/docforge/tests/parse.test.ts packages/docforge/tests/convert.test.ts packages/docforge/tests/edit.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/docforge/package.json pnpm-lock.yaml packages/docforge/src/parse.ts packages/docforge/src/compare.ts packages/docforge/src/index.ts packages/docforge/tests/compare.test.ts
git commit -m "feat: compare workspace documents as a unified markdown diff"
```

若 `pnpm-lock.yaml` 路径在仓库根，一并 add。不要 `git add -A`。

---

### Task 2: doc_compare 工具 + apply

**Files:**
- Modify: `packages/docforge/src/tools.ts`
- Modify: `packages/docforge/src/index.ts`
- Modify: `packages/docforge/tests/tools.test.ts`
- Modify: `packages/docforge/tests/plugin.test.ts`

**Interfaces:**
- Consumes: `compareDocuments`、`GENERATE_MAX_BYTES`
- Produces: `createDocCompareTool(): ToolDefinition`；`apply` 在 `createDocEditTool` 之后、`createDocIngestTool` 之前 `register`

成功 JSON 键顺序：`status`、`a`、`b`、`identical`、`diff`。路径为工作区相对，`\` → `/`。`identical` 是 JSON 布尔。

- [ ] **Step 1: 写失败测试**

`tools.test.ts`：从 `../src/tools.ts` 的 named import 增加 `createDocCompareTool`。追加：

```ts
it("compares markdown with ordered json", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "flintloom-ctool-ok-"));
  writeFileSync(join(workspace, "hello.md"), "# Hello\n\n发展\n");
  writeFileSync(join(workspace, "hi.md"), "# Hi\n\n发展\n");
  const tool = createDocCompareTool();
  const exec = createExec(workspace);
  const raw = await tool.execute({ a: "hello.md", b: "hi.md" }, exec);
  expect(Object.keys(JSON.parse(raw))).toEqual([
    "status",
    "a",
    "b",
    "identical",
    "diff",
  ]);
  const body = JSON.parse(raw);
  expect(body.status).toBe("ok");
  expect(body.a).toBe("hello.md");
  expect(body.b).toBe("hi.md");
  expect(body.identical).toBe(false);
  expect(typeof body.identical).toBe("boolean");
  expect(body.diff).toContain("-# Hello");
  expect(body.diff).toContain("+# Hi");
  expect(readFileSync(join(workspace, "hello.md"), "utf8")).toContain("# Hello");
  expect(readFileSync(join(workspace, "hi.md"), "utf8")).toContain("# Hi");
});

it("maps compare failures without writing", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "flintloom-ctool-"));
  writeFileSync(join(workspace, "hello.md"), "# Hello\n");
  writeFileSync(join(workspace, "x.bin"), Buffer.from([0, 1, 2, 3]));
  const tool = createDocCompareTool();
  const exec = createExec(workspace);

  expect(await tool.execute({ b: "hello.md" }, exec)).toBe("failed: missing a");
  expect(await tool.execute({ a: "hello.md" }, exec)).toBe("failed: missing b");
  expect(await tool.execute({ a: "nope.md", b: "hello.md" }, exec)).toBe(
    "failed: not found",
  );
  expect(await tool.execute({ a: "hello.md", b: "missing.md" }, exec)).toBe(
    "failed: not found",
  );
  expect(await tool.execute({ a: "hello.md", b: "x.bin" }, exec)).toBe(
    "failed: unsupported type",
  );
  expect(await tool.execute({ a: ".env", b: "hello.md" }, exec)).toBe(
    "failed: hidden",
  );
  await expect(tool.execute({ a: "../x.md", b: "hello.md" }, exec)).rejects.toThrow(
    WorkspaceEscapeError,
  );

  const same = JSON.parse(
    await tool.execute({ a: "hello.md", b: "hello.md" }, exec),
  );
  expect(same).toEqual({
    status: "ok",
    a: "hello.md",
    b: "hello.md",
    identical: true,
    diff: "",
  });
});

it("returns aborted when the compare signal is aborted", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "flintloom-ctool-ab-"));
  const ac = new AbortController();
  ac.abort();
  const tool = createDocCompareTool();
  expect(
    await tool.execute(
      { a: "a.md", b: "b.md" },
      createExec(workspace, ac.signal),
    ),
  ).toBe("aborted");
});
```

`plugin.test.ts`：第一个测试 `expect(names).toContain("doc_compare");`。再追加：

```ts
it("registers doc_compare and drops it on stop", () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), "flintloom-docforge-kb-")), "k.sqlite");
  const ctx = new Context();
  ctx.plugin(modelsPlugin);
  ctx.plugin(toolsPlugin);
  ctx.plugin(knowledgePlugin, { dbPath });
  const stop = ctx.plugin(plugin);
  const names = ctx.require<ToolRegistry>("tools").schemas().map((s) => s.name);
  expect(names).toContain("doc_compare");
  stop();
  expect(ctx.require<ToolRegistry>("tools").schemas().map((s) => s.name)).not.toContain(
    "doc_compare",
  );
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run packages/docforge/tests/tools.test.ts packages/docforge/tests/plugin.test.ts`

Expected: FAIL（无 `createDocCompareTool` 或 schema 无 `doc_compare`）

- [ ] **Step 3: 写最小实现**

`tools.ts`：

1. `import { compareDocuments } from "./compare.ts";`
2. named export 增加 `createDocCompareTool`（与其它 `createDoc*` 一起从本文件导出即可；`index.ts` 再 re-export）。
3. `FAIL_REASONS` 增加 `"missing a"`、`"missing b"`（`encrypted` / `unsupported type` 若已在集合中则不要重复）。
4. 在 `createDocEditTool` 之后追加：

```ts
export function createDocCompareTool(): ToolDefinition {
  return {
    name: "doc_compare",
    description:
      "Compare two workspace documents by parsing each to markdown and returning a unified diff. Pass a and b. Identical files return identical true and an empty diff. Do not use this to rewrite files (use doc_edit or fs) or to summarize (use doc_summarize later).",
    parameters: {
      type: "object",
      properties: {
        a: { type: "string" },
        b: { type: "string" },
      },
      required: ["a", "b"],
    },
    async execute(args, exec) {
      if (exec.signal.aborted) {
        return "aborted";
      }
      const a = strArg(args, "a");
      if (a === undefined) {
        return "failed: missing a";
      }
      const b = strArg(args, "b");
      if (b === undefined) {
        return "failed: missing b";
      }
      const absA = resolveInside(exec.workspaceRoot, a);
      const absB = resolveInside(exec.workspaceRoot, b);
      const realRoot = realpathSync.native(exec.workspaceRoot);
      const aRel = relative(realRoot, absA).replaceAll("\\", "/");
      const bRel = relative(realRoot, absB).replaceAll("\\", "/");
      if (
        isHiddenRelPath(a) ||
        isHiddenRelPath(b) ||
        isHiddenRelPath(aRel) ||
        isHiddenRelPath(bRel)
      ) {
        return "failed: hidden";
      }
      for (const absPath of [absA, absB]) {
        let st;
        try {
          st = await stat(absPath);
        } catch (err) {
          if (isNotFound(err)) {
            return "failed: not found";
          }
          return failFromError(err);
        }
        if (!st.isFile()) {
          return "failed: not a file";
        }
        if (st.size > GENERATE_MAX_BYTES) {
          return "failed: too large";
        }
      }
      try {
        const result = await compareDocuments(absA, absB, aRel, bRel);
        return JSON.stringify({
          status: "ok",
          a: aRel,
          b: bRel,
          identical: result.identical,
          diff: result.diff,
        });
      } catch (err) {
        return failFromError(err);
      }
    },
  };
}
```

`index.ts`：从 `./tools.ts` 的 import / re-export 增加 `createDocCompareTool`。`apply`：

```ts
ctx.effect(tools.register(createDocEditTool()));
ctx.effect(tools.register(createDocCompareTool()));
ctx.effect(tools.register(createDocIngestTool(kb)));
```

保留 Task 1 已加的 `compareDocuments` / `parseToMarkdown` 导出。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run packages/docforge/tests/tools.test.ts packages/docforge/tests/plugin.test.ts packages/docforge/tests/compare.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/docforge/src/tools.ts packages/docforge/src/index.ts packages/docforge/tests/tools.test.ts packages/docforge/tests/plugin.test.ts
git commit -m "feat: register doc_compare on the docforge plugin"
```

---

### Task 3: host factory 扫描 + 去掉 docforge + 全量验收

**Files:**
- Modify: `apps/host/tests/server.test.ts`

**Interfaces:**
- Consumes: Task 2 的工具名 `doc_compare`
- Produces: host `src` 不含 `createDocCompareTool`；yml 无 docforge 行则 schema 无该工具

本任务**只改测试**。不要改 `apps/host/src`。

- [ ] **Step 1: 写测试**

在 `host src does not import tool factories` 增加（放在 `createDocEditTool` 那一行旁边）：

```ts
expect(src).not.toMatch(/createDocCompareTool/);
```

不要写 `/compare/` 这类会误伤的正则。

现有 `omitting docforge from yml omits doc_generate` 增加：

```ts
expect(names).not.toContain("doc_compare");
```

- [ ] **Step 2: 跑 host 测试**

Run: `pnpm exec vitest run apps/host/tests/server.test.ts`

Expected: PASS（若 ASSEMBLY replace 失败，修字符串使其与 `apps/host/tests/assembly.ts` 完全一致）。

- [ ] **Step 3: 确认无泄漏**

不要改那些目录。在 `apps/host/src`、`packages/loop/src`、`packages/session/src`、`apps/desktop/src` 搜索 `createDocCompareTool`、`compareDocuments`、`parseToMarkdown`，结果必须为空。

- [ ] **Step 4: 全量测试**

Run: `pnpm test`

Expected: 全部 PASS。不打真实 DashScope。

- [ ] **Step 5: Commit**

```bash
git add apps/host/tests/server.test.ts
git commit -m "test: omit docforge drops doc_compare"
```

---

## Spec coverage

| Spec | Task |
|---|---|
| `parseToMarkdown` 判别联合；空 md 可比；`parse()` 仍 empty text | 1 |
| 正文以 `failed:` 开头仍成功；禁止 `startsWith` | 1 |
| `normalizeMarkdown`；CRLF vs LF identical；不 copyMarkdown | 1 |
| `createTwoFilesPatch` context 3；相对路径头；无 `a/` 前缀 | 1 |
| 相同跳过库；`diff === ""` | 1 |
| 字节上限先于读；字符上限；patch 超限 `too large` | 1 |
| `binary.bin` → `unsupported type` | 1–2 |
| `diff` ^8 依赖 | 1 |
| 工具 JSON 键顺序；布尔 `identical`；不写盘 | 2 |
| abort / missing a 先于 missing b / hidden / 越界 / not found | 2 |
| `apply` 在 edit 与 ingest 之间；`stop()` 撤销 | 2 |
| host factory 扫描；yml 省略 docforge | 3 |
| 不改 preview / loop / session / desktop / `createRuntime` register | 全任务都不碰那些文件 |
