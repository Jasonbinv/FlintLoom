# FlintLoom DocForge edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agent 能对工作区 markdown 调用 `doc_edit({ path, old, new })`，在规范化后的正文里把恰好出现一次的 `old` 换成 `new`（可空表示删除）并原地写回；0 次或 ≥2 次则失败且不改文件。

**Architecture:** 纯函数在 `@flintloom/docforge`：`normalizeMarkdown` → `countNonOverlap` → 一次替换 → `copyMarkdown` → `writeFile`。工具 `createDocEditTool` 做与 generate 相同的路径闸门后调用纯函数，经现有 `apply` 登记在 generate 与 ingest 之间。yml 不新加插件。不改 host 组装、不改 preview `kind`、不 mkdir。

**Tech Stack:** 现有 `detectType`、`copyMarkdown`、`GENERATE_MAX_BYTES` / `GENERATE_MAX_CHARS`。不新增 npm 依赖。禁止 `RegExp` 做匹配。

## Global Constraints

- 产品名 FlintLoom；包前缀 `@flintloom/*`；只绑 `127.0.0.1`。
- 不 import / submodule / 拷贝 dataagent-v3、deepseek-harness、Cordis。
- 禁止往 `createRuntime` 里 `register`。`apps/host/src` 不得出现 `createDocEditTool`；不要用正则禁止单词 `edit`。
- `packages/loop/src`、`packages/session/src`、`apps/desktop/src` 不得出现 `editMarkdown`。
- `detectType(path, bytes)` 两参数；先 `stat.size > GENERATE_MAX_BYTES` 再 `readFile`。禁止单参 `detectType(path)`。
- 匹配：去 BOM；`\r\n` / `\r` → `\n`；精确子串；**非重叠**计数。写回 LF、无 BOM、末尾 `\n`。
- `failed:` 理由只允许：`missing path` / `missing old` / `bad new` / `hidden` / `not found` / `not a file` / `too large` / `bad source` / `not unique` / `unreadable`。没有 `missing new`。
- `new` 缺省或 `""` 表示删除；`old` 必须非空。
- Windows 提交指定文件；不要 `git add -A`。不要提交 `check_libs.py`、`scripts/desktop-dev.ts`。

Spec：`docs/superpowers/specs/2026-08-18-flintloom-docforge-edit-design.md`

## File map

```text
packages/docforge/src/edit.ts           # normalizeMarkdown, countNonOverlap, editMarkdown
packages/docforge/src/tools.ts          # FAIL_REASONS + createDocEditTool
packages/docforge/src/index.ts          # 导出 + apply 在 generate 与 ingest 之间登记
packages/docforge/tests/edit.test.ts    # 纯函数验收
packages/docforge/tests/tools.test.ts   # 工具闸门 + 成功 JSON
packages/docforge/tests/plugin.test.ts  # schemas 含 doc_edit；stop() 撤销
apps/host/tests/server.test.ts          # factory 扫描 + yml 去掉 docforge
```

不改 `files.ts` preview、`writers/*`、yml 插件表、loop / session / desktop。

---

### Task 1: normalizeMarkdown + editMarkdown

**Files:**
- Create: `packages/docforge/src/edit.ts`
- Create: `packages/docforge/tests/edit.test.ts`
- Modify: `packages/docforge/src/index.ts`（导出新符号；本任务还不登记工具）

**Interfaces:**
- Consumes: `detectType`、`copyMarkdown`、`GENERATE_MAX_BYTES`、`GENERATE_MAX_CHARS`
- Produces:

```ts
export function normalizeMarkdown(raw: string): string;
export function countNonOverlap(haystack: string, needle: string): number;
export async function editMarkdown(
  absPath: string,
  old: string,
  replacement: string,
): Promise<{ replaced: 1 }>;
```

- [ ] **Step 1: 写失败测试**

`packages/docforge/tests/edit.test.ts`：

```ts
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GENERATE_MAX_BYTES } from "../src/generate.ts";
import {
  countNonOverlap,
  editMarkdown,
  normalizeMarkdown,
} from "../src/edit.ts";

const helloMd = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "fixtures/hello.md"),
  "utf8",
);

describe("normalizeMarkdown", () => {
  it("strips BOM and turns CRLF into LF", () => {
    expect(normalizeMarkdown("\uFEFF# Hello\r\n")).toBe("# Hello\n");
    expect(normalizeMarkdown("a\rb")).toBe("a\nb");
  });
});

describe("countNonOverlap", () => {
  it("counts non-overlapping hits", () => {
    expect(countNonOverlap("aaa", "aa")).toBe(1);
    expect(countNonOverlap("aaaa", "aa")).toBe(2);
    expect(countNonOverlap("hello", "x")).toBe(0);
  });
});

describe("editMarkdown", () => {
  it("replaces Hello once and keeps 发展", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-edit-ok-"));
    const path = join(dir, "hello.md");
    writeFileSync(path, helloMd);
    await expect(editMarkdown(path, "# Hello", "# Hi")).resolves.toEqual({
      replaced: 1,
    });
    const text = readFileSync(path, "utf8");
    expect(text).toContain("# Hi");
    expect(text).toContain("发展");
    expect(text).not.toContain("# Hello");
  });

  it("deletes image syntax when replacement is empty", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-edit-del-"));
    const path = join(dir, "hello.md");
    writeFileSync(path, helloMd);
    await editMarkdown(path, "![skip](x.png)", "");
    const text = readFileSync(path, "utf8");
    expect(text).not.toContain("![skip](x.png)");
    expect(text).toContain("# Hello");
  });

  it("rejects duplicate old and leaves bytes unchanged", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-edit-dup-"));
    const path = join(dir, "dup.md");
    const original = "foo\nfoo\n";
    writeFileSync(path, original);
    await expect(editMarkdown(path, "foo", "bar")).rejects.toThrow(/not unique/);
    expect(readFileSync(path, "utf8")).toBe(original);
  });

  it("rejects missing old substring", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-edit-miss-"));
    const path = join(dir, "hello.md");
    writeFileSync(path, helloMd);
    await expect(editMarkdown(path, "# Missing", "x")).rejects.toThrow(/not found/);
    expect(readFileSync(path, "utf8")).toBe(helloMd);
  });

  it("matches LF old against CRLF file and writes LF without BOM", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-edit-crlf-"));
    const path = join(dir, "hello.md");
    writeFileSync(path, "\uFEFF# Hello\r\n发展\r\n");
    await editMarkdown(path, "# Hello", "# Hi");
    const text = readFileSync(path, "utf8");
    expect(text.startsWith("\uFEFF")).toBe(false);
    expect(text).not.toContain("\r");
    expect(text.endsWith("\n")).toBe(true);
    expect(text).toContain("# Hi");
  });

  it("replaces overlapping aa in aaa once", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-edit-ov-"));
    const path = join(dir, "a.md");
    writeFileSync(path, "aaa\n");
    await editMarkdown(path, "aa", "bb");
    expect(readFileSync(path, "utf8")).toBe("bba\n");
  });

  it("rejects non-md and huge files before parsing as utf8", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-edit-bad-"));
    const docx = join(dir, "x.docx");
    writeFileSync(docx, "not-md");
    await expect(editMarkdown(docx, "a", "b")).rejects.toThrow(/bad source/);
    const huge = join(dir, "huge.md");
    writeFileSync(huge, Buffer.alloc(GENERATE_MAX_BYTES + 1, 0x61));
    await expect(editMarkdown(huge, "a", "b")).rejects.toThrow(/too large/);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run packages/docforge/tests/edit.test.ts`

Expected: FAIL（`edit.ts` 不存在）

- [ ] **Step 3: 写最小实现**

`packages/docforge/src/edit.ts`：

```ts
import { readFile, stat, writeFile } from "node:fs/promises";
import { detectType } from "./detect.ts";
import {
  GENERATE_MAX_BYTES,
  GENERATE_MAX_CHARS,
  copyMarkdown,
} from "./generate.ts";

export function normalizeMarkdown(raw: string): string {
  const body = raw.startsWith("\uFEFF") ? raw.slice(1) : raw;
  return body.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

export function countNonOverlap(haystack: string, needle: string): number {
  if (needle.length === 0) {
    return 0;
  }
  let n = 0;
  let i = 0;
  while (true) {
    const found = haystack.indexOf(needle, i);
    if (found === -1) {
      return n;
    }
    n += 1;
    i = found + needle.length;
  }
}

function ioCode(err: unknown): string {
  return typeof err === "object" && err !== null && "code" in err
    ? (err as { code: string }).code
    : "";
}

export async function editMarkdown(
  absPath: string,
  old: string,
  replacement: string,
): Promise<{ replaced: 1 }> {
  if (old.length === 0) {
    throw new Error("missing old");
  }
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
  const bytes = await readFile(absPath);
  if (detectType(absPath, bytes) !== "md") {
    throw new Error("bad source");
  }
  const body = normalizeMarkdown(bytes.toString("utf8"));
  if (body.length > GENERATE_MAX_CHARS) {
    throw new Error("too large");
  }
  const hits = countNonOverlap(body, old);
  if (hits === 0) {
    throw new Error("not found");
  }
  if (hits >= 2) {
    throw new Error("not unique");
  }
  const at = body.indexOf(old);
  const next = `${body.slice(0, at)}${replacement}${body.slice(at + old.length)}`;
  const out = copyMarkdown(next);
  if (out.length > GENERATE_MAX_CHARS) {
    throw new Error("too large");
  }
  await writeFile(absPath, out, "utf8");
  return { replaced: 1 };
}
```

禁止 `new RegExp(old)`。`detectType` 必须两参数。

`packages/docforge/src/index.ts` 增加导出（不要在本任务改 `apply`）：

```ts
export { countNonOverlap, editMarkdown, normalizeMarkdown } from "./edit.ts";
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run packages/docforge/tests/edit.test.ts packages/docforge/tests/generate.test.ts packages/docforge/tests/convert.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/docforge/src/edit.ts packages/docforge/src/index.ts packages/docforge/tests/edit.test.ts
git commit -m "feat: replace a unique substring in workspace markdown"
```

---

### Task 2: doc_edit 工具 + apply

**Files:**
- Modify: `packages/docforge/src/tools.ts`
- Modify: `packages/docforge/src/index.ts`
- Modify: `packages/docforge/tests/tools.test.ts`
- Modify: `packages/docforge/tests/plugin.test.ts`

**Interfaces:**
- Consumes: `editMarkdown`、`GENERATE_MAX_BYTES`
- Produces: `createDocEditTool(): ToolDefinition`；`apply` 在 `createDocGenerateTool` 之后、`createDocIngestTool` 之前 `register`

成功 JSON 键顺序：`status`、`path`、`replaced`。`path` 为工作区相对路径，`\` → `/`。

- [ ] **Step 1: 写失败测试**

`tools.test.ts`：从 `../src/tools.ts` 的 named import 增加 `createDocEditTool`。追加：

```ts
it("edits markdown with ordered json", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "flintloom-etool-ok-"));
  writeFileSync(join(workspace, "hello.md"), "# Hello\n\n发展\n");
  const tool = createDocEditTool();
  const exec = createExec(workspace);
  const raw = await tool.execute(
    { path: "hello.md", old: "# Hello", new: "# Hi" },
    exec,
  );
  expect(Object.keys(JSON.parse(raw))).toEqual(["status", "path", "replaced"]);
  expect(JSON.parse(raw)).toEqual({
    status: "ok",
    path: "hello.md",
    replaced: 1,
  });
  expect(readFileSync(join(workspace, "hello.md"), "utf8")).toContain("# Hi");
});

it("maps edit failures without writing", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "flintloom-etool-"));
  writeFileSync(join(workspace, "hello.md"), "# Hello\n");
  writeFileSync(join(workspace, "dup.md"), "foo\nfoo\n");
  writeFileSync(join(workspace, "x.docx"), "x");
  const tool = createDocEditTool();
  const exec = createExec(workspace);

  expect(await tool.execute({ old: "a", new: "b" }, exec)).toBe("failed: missing path");
  expect(await tool.execute({ path: "hello.md" }, exec)).toBe("failed: missing old");
  expect(await tool.execute({ path: "hello.md", old: "# Hello", new: 1 }, exec)).toBe(
    "failed: bad new",
  );
  expect(await tool.execute({ path: "dup.md", old: "foo", new: "bar" }, exec)).toBe(
    "failed: not unique",
  );
  expect(readFileSync(join(workspace, "dup.md"), "utf8")).toBe("foo\nfoo\n");
  expect(await tool.execute({ path: "hello.md", old: "# Missing", new: "x" }, exec)).toBe(
    "failed: not found",
  );
  expect(await tool.execute({ path: "nope.md", old: "a", new: "b" }, exec)).toBe(
    "failed: not found",
  );
  expect(await tool.execute({ path: "x.docx", old: "x", new: "y" }, exec)).toBe(
    "failed: bad source",
  );
  expect(await tool.execute({ path: ".env", old: "a", new: "b" }, exec)).toBe(
    "failed: hidden",
  );
  await expect(tool.execute({ path: "../x.md", old: "a", new: "b" }, exec)).rejects.toThrow(
    WorkspaceEscapeError,
  );

  expect(
    JSON.parse(
      await tool.execute({ path: "hello.md", old: "# Hello", new: "" }, exec),
    ).status,
  ).toBe("ok");
  expect(readFileSync(join(workspace, "hello.md"), "utf8")).not.toContain("# Hello");
});

it("returns aborted when the edit signal is aborted", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "flintloom-etool-ab-"));
  const ac = new AbortController();
  ac.abort();
  const tool = createDocEditTool();
  expect(
    await tool.execute(
      { path: "a.md", old: "a", new: "b" },
      createExec(workspace, ac.signal),
    ),
  ).toBe("aborted");
});
```

`plugin.test.ts`：现有 `registers doc_probe...` 用例增加 `toContain("doc_edit")`。再增加：

```ts
it("registers doc_edit and drops it on stop", () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), "flintloom-docforge-kb-")), "k.sqlite");
  const ctx = new Context();
  ctx.plugin(modelsPlugin);
  ctx.plugin(toolsPlugin);
  ctx.plugin(knowledgePlugin, { dbPath });
  const stop = ctx.plugin(plugin);
  const names = ctx.require<ToolRegistry>("tools").schemas().map((s) => s.name);
  expect(names).toContain("doc_edit");
  stop();
  expect(ctx.require<ToolRegistry>("tools").schemas().map((s) => s.name)).not.toContain(
    "doc_edit",
  );
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run packages/docforge/tests/tools.test.ts packages/docforge/tests/plugin.test.ts`

Expected: FAIL（`createDocEditTool` 未导出）

- [ ] **Step 3: 实现工具**

`tools.ts`：`FAIL_REASONS` 增加 `"missing path"`、`"missing old"`、`"bad new"`、`"not unique"`。增加 import：

```ts
import { editMarkdown } from "./edit.ts";
```

增加 helper（放在 `strArg` 旁）：

```ts
function newArg(args: Record<string, unknown>): string | undefined {
  if (!Object.hasOwn(args, "new") || args.new === undefined) {
    return "";
  }
  return typeof args.new === "string" ? args.new : undefined;
}
```

`newArg` 返回 `undefined` 表示 `bad new`；返回 `""` 表示删除。

在 `createDocGenerateTool` 之后追加：

```ts
export function createDocEditTool(): ToolDefinition {
  return {
    name: "doc_edit",
    description:
      "Replace one exact substring in a workspace markdown file. Pass path, old, and new; new may be empty to delete. old must occur exactly once after newline normalization. Do not use this to rewrite a whole file (use fs) or to edit pdf/docx (convert to md first).",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        old: { type: "string" },
        new: { type: "string" },
      },
      required: ["path", "old"],
    },
    async execute(args, exec) {
      if (exec.signal.aborted) {
        return "aborted";
      }
      const inputPath = strArg(args, "path");
      if (inputPath === undefined) {
        return "failed: missing path";
      }
      const old = strArg(args, "old");
      if (old === undefined) {
        return "failed: missing old";
      }
      const replacement = newArg(args);
      if (replacement === undefined) {
        return "failed: bad new";
      }
      const absPath = resolveInside(exec.workspaceRoot, inputPath);
      const realRoot = realpathSync.native(exec.workspaceRoot);
      const pathRel = relative(realRoot, absPath).replaceAll("\\", "/");
      if (isHiddenRelPath(inputPath) || isHiddenRelPath(pathRel)) {
        return "failed: hidden";
      }
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
      try {
        const result = await editMarkdown(absPath, old, replacement);
        return JSON.stringify({
          status: "ok",
          path: pathRel,
          replaced: result.replaced,
        });
      } catch (err) {
        return failFromError(err);
      }
    },
  };
}
```

检查顺序必须是 abort → missing path → missing old → bad new → resolveInside → hidden → stat / not found / not a file / too large → `editMarkdown`。不要在 hidden 之前 `stat`。

`index.ts`：

```ts
import {
  createDocConvertTool,
  createDocEditTool,
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
  createDocEditTool,
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
    ctx.effect(tools.register(createDocEditTool()));
    ctx.effect(tools.register(createDocIngestTool(kb)));
  },
};
```

保留 Task 1 已加的 `editMarkdown` 导出。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run packages/docforge/tests/tools.test.ts packages/docforge/tests/plugin.test.ts packages/docforge/tests/edit.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/docforge/src/tools.ts packages/docforge/src/index.ts packages/docforge/tests/tools.test.ts packages/docforge/tests/plugin.test.ts
git commit -m "feat: register doc_edit on the docforge plugin"
```

---

### Task 3: host factory 扫描 + 去掉 docforge + 全量验收

**Files:**
- Modify: `apps/host/tests/server.test.ts`

**Interfaces:**
- Consumes: Task 2 的工具名 `doc_edit`
- Produces: host `src` 不含 `createDocEditTool`；yml 无 docforge 行则 schema 无该工具

本任务**只改测试**。不要改 `apps/host/src`。

- [ ] **Step 1: 写测试**

在 `host src does not import tool factories` 增加（放在 `createDocConvertTool` 那一行旁边）：

```ts
expect(src).not.toMatch(/createDocEditTool/);
```

不要写 `/edit/` 这类会误伤的正则。

现有 `omitting docforge from yml omits doc_generate` 增加：

```ts
expect(names).not.toContain("doc_edit");
```

- [ ] **Step 2: 跑 host 测试**

Run: `pnpm exec vitest run apps/host/tests/server.test.ts`

Expected: PASS（若 ASSEMBLY replace 失败，修字符串使其与 `apps/host/tests/assembly.ts` 完全一致）。

- [ ] **Step 3: 确认无泄漏**

不要改那些目录。在 `apps/host/src`、`packages/loop/src`、`packages/session/src`、`apps/desktop/src` 搜索 `createDocEditTool`、`editMarkdown`，结果必须为空。

- [ ] **Step 4: 全量测试**

Run: `pnpm test`

Expected: 全部 PASS。不打真实 DashScope。

- [ ] **Step 5: Commit**

```bash
git add apps/host/tests/server.test.ts
git commit -m "test: omit docforge drops doc_edit"
```

---

## Spec coverage

| Spec | Task |
|---|---|
| `normalizeMarkdown` 去 BOM、CRLF/`\r`→LF | 1 |
| `countNonOverlap` 非重叠；`aaa`/`aa` = 1 | 1 |
| `detectType(path, bytes)`；非 md → `bad source` | 1 |
| 唯一替换；空 `replacement` 删除；写回 LF 无 BOM 末尾 `\n` | 1 |
| 0 次 `not found`；≥2 `not unique`；文件不变 | 1 |
| 字节上限先于读盘；`copyMarkdown` 后字符上限 | 1 |
| 工具顺序、hidden、`../outside`、缺 path 先于缺 old、`bad new` | 2 |
| 成功 JSON `status,path,replaced` | 2 |
| `new` 可缺省；无 `missing new` | 2 |
| `apply` 在 generate 与 ingest 之间；`stop()` | 2 |
| host 不 import 工厂；yml 去掉 docforge | 3 |
| 不改 preview / 不改 pdf/docx / 不用正则匹配 | 全任务都不碰那些文件 |
