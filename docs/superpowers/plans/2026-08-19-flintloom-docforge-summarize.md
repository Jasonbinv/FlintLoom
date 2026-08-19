# FlintLoom DocForge summarize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agent 能对工作区文档调用 `doc_summarize({ path })`，parse 成 markdown 后由内层 `chat.stream` 生成最多 4000 字摘要 JSON；全文不进 `tool/result`、不进 session log。

**Architecture:** `summarizeDocument` 做 stat / `parseToMarkdown` / empty / `normalizeMarkdown` / 字符上限，再 `models.resolveChat()` 与 `chat.stream({ messages, tools: [] }, signal)`。`createDocSummarizeTool(models)` 走 parse/edit 同款单路径闸门，经现有 `apply` 登记在 compare 与 ingest 之间。yml 不新加插件。不改 loop / session / `ChatRequest` / `models-chat` / preview `kind`。

**Tech Stack:** 现有 `parseToMarkdown`、`normalizeMarkdown`、`GENERATE_MAX_BYTES` / `GENERATE_MAX_CHARS`、`ModelRegistry` / `ChatProvider`。把 `@flintloom/models` 升为 `@flintloom/docforge` runtime 依赖。不新增其它 npm 包。假 `ChatProvider` 测；不打真实网。

## Global Constraints

- 产品名 FlintLoom；包前缀 `@flintloom/*`；只绑 `127.0.0.1`。
- 不 import / submodule / 拷贝 dataagent-v3、deepseek-harness、Cordis。
- 禁止往 `createRuntime` 里 `register`。`apps/host/src` 不得出现 `createDocSummarizeTool`。不要用正则禁止单词 `summarize`。
- `packages/loop/src`、`packages/session/src`、`apps/desktop/src` 不得出现 `summarizeDocument`。
- `detectType(path, bytes)` 两参数；先 `stat.size > GENERATE_MAX_BYTES` 再读/parse。禁止单参 `detectType(path)`。禁止用 `startsWith("failed: ")` 判断 parse 成败。
- `apply` **不得**调用 `resolveChat()`。每次 `execute` 在 parse 成功且未超限之后再 `resolveChat()`。缺 chat → `failed: unreadable`，不发明 `missing chat`。
- 内层：`chat.stream(req, signal)` 两参数；`req.tools` 必须为 `[]`；`messages` 只有 system + user；不带 `deriveMessages()`。不扩展 `ChatRequest` / `ToolExec`。不改 `@flintloom/models-chat`。
- `SUMMARIZE_SYSTEM` 原文禁止改字。摘要除 `slice(0, 4000)` 外原样保留：不 trim、不剥 fence、不追加 `[truncated]`。
- chunk：只拼 `text`；忽略 `tool_call`；`error` 立即 `unreadable` 并丢弃已拼文本。无 text → `unreadable`。内层失败不发 `model/error`、不把 turn 标 failed。
- `failed:` 理由只允许：`missing path` / `hidden` / `not found` / `not a file` / `too large` / `unsupported type` / `encrypted` / `empty text` / `unreadable`。abort 返回字面 `"aborted"`。
- 不写盘。空正文是 `empty text`（与 compare 不同）。
- Windows 提交指定文件；不要 `git add -A`。不要提交 `check_libs.py`、`scripts/desktop-dev.ts`。

Spec：`docs/superpowers/specs/2026-08-19-flintloom-docforge-summarize-design.md`

## File map

```text
packages/docforge/package.json                 # @flintloom/models 升为 dependencies
pnpm-lock.yaml                                # 若 pnpm install 有改动
packages/docforge/src/summarize.ts             # 常量 + summarizeDocument
packages/docforge/src/tools.ts                 # createDocSummarizeTool；改 compare description
packages/docforge/src/index.ts                 # 导出 + apply 在 compare 与 ingest 之间登记
packages/docforge/tests/summarize.test.ts      # 纯函数 + 假 ChatProvider
packages/docforge/tests/tools.test.ts          # 工具闸门 + 成功 JSON
packages/docforge/tests/plugin.test.ts         # schemas 含 doc_summarize；stop()；无 models
apps/host/tests/server.test.ts                 # factory 扫描 + yml omit + 默认 assembly 含该工具
```

不改 `files.ts` preview、`writers/*`、yml 插件表、loop / session / desktop / `models-chat`。`files.ts` 仍可 import `parse` / `probe`。

---

### Task 1: summarizeDocument

**Files:**
- Create: `packages/docforge/src/summarize.ts`
- Create: `packages/docforge/tests/summarize.test.ts`
- Modify: `packages/docforge/src/index.ts`（导出；本任务还不登记工具、不 `require("models")`）
- Modify: `packages/docforge/package.json`（`@flintloom/models` 从 `devDependencies` 挪到 `dependencies`，值为 `workspace:*`；`devDependencies` 只留 `@types/pdfkit`）
- Modify: `pnpm-lock.yaml`（根目录 `pnpm install` 若有 diff 则纳入）

**Interfaces:**
- Consumes: `parseToMarkdown`、`normalizeMarkdown`、`GENERATE_MAX_BYTES`、`GENERATE_MAX_CHARS`、`ModelRegistry`、`ModelKindMissingError`、`ChatProvider.stream(req, signal)`
- Produces:

```ts
export const SUMMARIZE_MAX_CHARS = 4000;

export const SUMMARIZE_SYSTEM =
  "Summarize the document in the user message. Write the summary only. Use the same language as the document. Do not call tools. Do not wrap the summary in markdown fences.";

export type SummarizeResult =
  | { ok: true; summary: string }
  | {
      ok: false;
      reason:
        | "aborted"
        | "not found"
        | "not a file"
        | "too large"
        | "unsupported type"
        | "encrypted"
        | "empty text"
        | "unreadable";
    };

export async function summarizeDocument(
  absPath: string,
  models: ModelRegistry,
  signal: AbortSignal,
): Promise<SummarizeResult>;
```

- [ ] **Step 1: 把 models 升为 runtime 依赖**

编辑 `packages/docforge/package.json`：`dependencies` 增加 `"@flintloom/models": "workspace:*"`（放在 `@flintloom/knowledge` 与 `@flintloom/tools` 之间）。从 `devDependencies` 删除 `@flintloom/models`。

在仓库根 `flintloom` 跑：

```bash
pnpm install
```

Expected: 成功。`package.json` 不再把 models 同时写在 dependencies 和 devDependencies。

- [ ] **Step 2: 写失败测试**

`packages/docforge/tests/summarize.test.ts`：

```ts
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ModelRegistry,
  type ChatProvider,
  type ChatRequest,
} from "@flintloom/models";
import { GENERATE_MAX_BYTES, GENERATE_MAX_CHARS } from "../src/generate.ts";
import {
  SUMMARIZE_MAX_CHARS,
  SUMMARIZE_SYSTEM,
  summarizeDocument,
} from "../src/summarize.ts";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const helloMd = readFileSync(join(fixtures, "hello.md"), "utf8");
const binaryBin = join(fixtures, "binary.bin");

function liveSignal(): AbortSignal {
  return new AbortController().signal;
}

function registryWith(
  stream: ChatProvider["stream"],
): { models: ModelRegistry; calls: { n: number } } {
  const calls = { n: 0 };
  const models = new ModelRegistry();
  models.registerChat("default", {
    async *stream(req, signal) {
      calls.n += 1;
      yield* stream(req, signal);
    },
  });
  models.setDefault("chat", "default");
  return { models, calls };
}

describe("summarizeDocument", () => {
  it("summarizes hello.md through a fake chat", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-sum-ok-"));
    const path = join(dir, "hello.md");
    writeFileSync(path, helloMd);
    const signal = liveSignal();
    let captured: ChatRequest | undefined;
    let capturedSignal: AbortSignal | undefined;
    const { models } = registryWith(async function* (req, sig) {
      captured = req;
      capturedSignal = sig;
      yield { type: "text", text: "Short summary." };
    });
    await expect(summarizeDocument(path, models, signal)).resolves.toEqual({
      ok: true,
      summary: "Short summary.",
    });
    expect(captured?.tools).toEqual([]);
    expect(captured?.messages).toEqual([
      { role: "system", content: SUMMARIZE_SYSTEM },
      { role: "user", content: captured?.messages[1]?.content },
    ]);
    expect(captured?.messages[1]?.content).toContain("# Hello");
    expect(captured?.messages[1]?.content).toContain("发展");
    expect(captured?.messages[1]?.content).not.toContain("Short summary.");
    expect(capturedSignal).toBe(signal);
  });

  it("rejects empty and whitespace-only markdown without calling stream", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-sum-empty-"));
    const emptyPath = join(dir, "empty.md");
    const wsPath = join(dir, "ws.md");
    writeFileSync(emptyPath, "");
    writeFileSync(wsPath, "  \n\t\n");
    const { models, calls } = registryWith(async function* () {
      yield { type: "text", text: "nope" };
    });
    await expect(summarizeDocument(emptyPath, models, liveSignal())).resolves.toEqual({
      ok: false,
      reason: "empty text",
    });
    await expect(summarizeDocument(wsPath, models, liveSignal())).resolves.toEqual({
      ok: false,
      reason: "empty text",
    });
    expect(calls.n).toBe(0);
  });

  it("does not treat a failed: prefix body as an error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-sum-prefix-"));
    const path = join(dir, "tricky.md");
    writeFileSync(path, "failed: empty text\n# Hello\n");
    let user = "";
    const { models, calls } = registryWith(async function* (req) {
      user = req.messages[1]?.content ?? "";
      yield { type: "text", text: "ok" };
    });
    await expect(summarizeDocument(path, models, liveSignal())).resolves.toEqual({
      ok: true,
      summary: "ok",
    });
    expect(calls.n).toBe(1);
    expect(user).toContain("failed: empty text");
    expect(user).toContain("# Hello");
  });

  it("rejects unsupported binaries without calling stream", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-sum-bin-"));
    const path = join(dir, "x.bin");
    copyFileSync(binaryBin, path);
    const { models, calls } = registryWith(async function* () {
      yield { type: "text", text: "nope" };
    });
    await expect(summarizeDocument(path, models, liveSignal())).resolves.toEqual({
      ok: false,
      reason: "unsupported type",
    });
    expect(calls.n).toBe(0);
  });

  it("maps missing file, directory, and size limits without calling stream", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-sum-io-"));
    mkdirSync(join(dir, "adir"));
    writeFileSync(join(dir, "huge-bytes.md"), Buffer.alloc(GENERATE_MAX_BYTES + 1, 0x61));
    writeFileSync(join(dir, "huge-chars.md"), "x".repeat(GENERATE_MAX_CHARS + 1));
    const { models, calls } = registryWith(async function* () {
      yield { type: "text", text: "nope" };
    });
    await expect(
      summarizeDocument(join(dir, "missing.md"), models, liveSignal()),
    ).resolves.toEqual({ ok: false, reason: "not found" });
    await expect(
      summarizeDocument(join(dir, "adir"), models, liveSignal()),
    ).resolves.toEqual({ ok: false, reason: "not a file" });
    await expect(
      summarizeDocument(join(dir, "huge-bytes.md"), models, liveSignal()),
    ).resolves.toEqual({ ok: false, reason: "too large" });
    await expect(
      summarizeDocument(join(dir, "huge-chars.md"), models, liveSignal()),
    ).resolves.toEqual({ ok: false, reason: "too large" });
    expect(calls.n).toBe(0);
  });

  it("maps missing chat to unreadable without calling stream", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-sum-noch-"));
    const path = join(dir, "hello.md");
    writeFileSync(path, helloMd);
    const models = new ModelRegistry();
    const result = await summarizeDocument(path, models, liveSignal());
    expect(result).toEqual({ ok: false, reason: "unreadable" });
    expect(JSON.stringify(result)).not.toContain("未配置 chat");
  });

  it("silently slices summaries longer than SUMMARIZE_MAX_CHARS", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-sum-cap-"));
    const path = join(dir, "hello.md");
    writeFileSync(path, helloMd);
    const { models } = registryWith(async function* () {
      yield { type: "text", text: "a".repeat(SUMMARIZE_MAX_CHARS + 1) };
    });
    const result = await summarizeDocument(path, models, liveSignal());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.summary.length).toBe(SUMMARIZE_MAX_CHARS);
      expect(result.summary.includes("[truncated]")).toBe(false);
    }
  });

  it("maps tool_call-only and error chunks to unreadable", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-sum-chunk-"));
    const path = join(dir, "hello.md");
    writeFileSync(path, helloMd);
    const onlyCall = registryWith(async function* () {
      yield { type: "tool_call", id: "1", name: "fs", args: {} };
    });
    await expect(
      summarizeDocument(path, onlyCall.models, liveSignal()),
    ).resolves.toEqual({ ok: false, reason: "unreadable" });

    const textThenCall = registryWith(async function* () {
      yield { type: "text", text: "Keep me." };
      yield { type: "tool_call", id: "1", name: "fs", args: {} };
    });
    await expect(
      summarizeDocument(path, textThenCall.models, liveSignal()),
    ).resolves.toEqual({ ok: true, summary: "Keep me." });

    const errAfterText = registryWith(async function* () {
      yield { type: "text", text: "partial" };
      yield { type: "error", message: "HTTP 500: secret-token" };
    });
    const failed = await summarizeDocument(path, errAfterText.models, liveSignal());
    expect(failed).toEqual({ ok: false, reason: "unreadable" });
    expect(JSON.stringify(failed)).not.toContain("secret-token");
    expect(JSON.stringify(failed)).not.toContain("partial");
  });

  it("returns aborted when the signal aborts during stream", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-sum-ab-"));
    const path = join(dir, "hello.md");
    writeFileSync(path, helloMd);
    const ac = new AbortController();
    const models = new ModelRegistry();
    models.registerChat("default", {
      async *stream() {
        ac.abort();
        throw new Error("network");
      },
    });
    models.setDefault("chat", "default");
    await expect(summarizeDocument(path, models, ac.signal)).resolves.toEqual({
      ok: false,
      reason: "aborted",
    });
  });

  it("sends LF to chat when the source is CRLF", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-sum-crlf-"));
    const path = join(dir, "crlf.md");
    writeFileSync(path, "# Hello\r\n\r\n发展\r\n");
    let user = "";
    const { models } = registryWith(async function* (req) {
      user = req.messages[1]?.content ?? "";
      yield { type: "text", text: "ok" };
    });
    await expect(summarizeDocument(path, models, liveSignal())).resolves.toEqual({
      ok: true,
      summary: "ok",
    });
    expect(user).toContain("# Hello");
    expect(user).toContain("发展");
    expect(user.includes("\r")).toBe(false);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm exec vitest run packages/docforge/tests/summarize.test.ts`

Expected: FAIL（无法解析 `../src/summarize.ts`）

- [ ] **Step 4: 写最小实现**

`packages/docforge/src/summarize.ts`：

```ts
import { stat } from "node:fs/promises";
import { type ChatRequest, type ModelRegistry } from "@flintloom/models";
import { normalizeMarkdown } from "./edit.ts";
import { GENERATE_MAX_BYTES, GENERATE_MAX_CHARS } from "./generate.ts";
import { parseToMarkdown } from "./parse.ts";

export const SUMMARIZE_MAX_CHARS = 4000;

export const SUMMARIZE_SYSTEM =
  "Summarize the document in the user message. Write the summary only. Use the same language as the document. Do not call tools. Do not wrap the summary in markdown fences.";

export type SummarizeResult =
  | { ok: true; summary: string }
  | {
      ok: false;
      reason:
        | "aborted"
        | "not found"
        | "not a file"
        | "too large"
        | "unsupported type"
        | "encrypted"
        | "empty text"
        | "unreadable";
    };

function ioCode(err: unknown): string {
  return typeof err === "object" && err !== null && "code" in err
    ? (err as { code: string }).code
    : "";
}

export async function summarizeDocument(
  absPath: string,
  models: ModelRegistry,
  signal: AbortSignal,
): Promise<SummarizeResult> {
  if (signal.aborted) {
    return { ok: false, reason: "aborted" };
  }

  let st;
  try {
    st = await stat(absPath);
  } catch (err) {
    if (ioCode(err) === "ENOENT") {
      return { ok: false, reason: "not found" };
    }
    return { ok: false, reason: "unreadable" };
  }
  if (!st.isFile()) {
    return { ok: false, reason: "not a file" };
  }
  if (st.size > GENERATE_MAX_BYTES) {
    return { ok: false, reason: "too large" };
  }

  const parsed = await parseToMarkdown(absPath);
  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason };
  }
  if (parsed.markdown.replace(/\s+/g, " ").trim().length === 0) {
    return { ok: false, reason: "empty text" };
  }

  const markdown = normalizeMarkdown(parsed.markdown);
  if (markdown.length > GENERATE_MAX_CHARS) {
    return { ok: false, reason: "too large" };
  }

  let chat;
  try {
    chat = models.resolveChat();
  } catch {
    return { ok: false, reason: "unreadable" };
  }

  const req: ChatRequest = {
    messages: [
      { role: "system", content: SUMMARIZE_SYSTEM },
      { role: "user", content: markdown },
    ],
    tools: [],
  };

  let joined = "";
  try {
    for await (const chunk of chat.stream(req, signal)) {
      if (signal.aborted) {
        return { ok: false, reason: "aborted" };
      }
      if (chunk.type === "error") {
        return { ok: false, reason: "unreadable" };
      }
      if (chunk.type === "text") {
        joined += chunk.text;
      }
    }
  } catch {
    if (signal.aborted) {
      return { ok: false, reason: "aborted" };
    }
    return { ok: false, reason: "unreadable" };
  }

  if (signal.aborted) {
    return { ok: false, reason: "aborted" };
  }
  if (joined.length === 0) {
    return { ok: false, reason: "unreadable" };
  }
  return { ok: true, summary: joined.slice(0, SUMMARIZE_MAX_CHARS) };
}
```

把 `catch (err) { if (err instanceof ModelKindMissingError || true)` 写成只返回 `unreadable`（`resolveChat` 失败一律 `unreadable`）。不要把 `err.message` 放进返回值。不要 `trim` 摘要、不要剥 fence、不要调用 `truncateOutput`。

`packages/docforge/src/index.ts` 在现有 `export { compareDocuments }` 旁增加（本任务不要改 `apply`）：

```ts
export type { SummarizeResult } from "./summarize.ts";
export {
  SUMMARIZE_MAX_CHARS,
  SUMMARIZE_SYSTEM,
  summarizeDocument,
} from "./summarize.ts";
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm exec vitest run packages/docforge/tests/summarize.test.ts packages/docforge/tests/parse.test.ts packages/docforge/tests/compare.test.ts packages/docforge/tests/edit.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/docforge/package.json pnpm-lock.yaml packages/docforge/src/summarize.ts packages/docforge/src/index.ts packages/docforge/tests/summarize.test.ts
git commit -m "feat: summarize workspace documents via inner chat stream"
```

`pnpm-lock.yaml` 若无改动则不要 add。不要 `git add -A`。

---

### Task 2: doc_summarize 工具 + apply

**Files:**
- Modify: `packages/docforge/src/tools.ts`
- Modify: `packages/docforge/src/index.ts`
- Modify: `packages/docforge/tests/tools.test.ts`
- Modify: `packages/docforge/tests/plugin.test.ts`

**Interfaces:**
- Consumes: `summarizeDocument`、`SUMMARIZE_SYSTEM`、`GENERATE_MAX_BYTES`、`ModelRegistry`
- Produces: `createDocSummarizeTool(models: ModelRegistry): ToolDefinition`；`apply` 在 `createDocCompareTool` 之后、`createDocIngestTool` 之前 `register`；`doc_compare` description 去掉 “later”

成功 JSON 键顺序：`status`、`path`、`summary`。路径为工作区相对，`\` → `/`。`FAIL_REASONS` 不新增条目（`empty text` / `unreadable` 已在集合中）。

- [ ] **Step 1: 写失败测试**

`tools.test.ts`：named import 增加 `createDocSummarizeTool`。增加：

```ts
import { ModelRegistry } from "@flintloom/models";
```

在文件底部、最后一个 `describe` 的 `});` 之前追加：

```ts
it("summarizes markdown with ordered json", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "flintloom-stool-ok-"));
  writeFileSync(join(workspace, "hello.md"), "# Hello\n\n发展\n");
  const models = new ModelRegistry();
  let capturedTools: unknown;
  let capturedSignal: AbortSignal | undefined;
  models.registerChat("default", {
    async *stream(req, signal) {
      capturedTools = req.tools;
      capturedSignal = signal;
      yield { type: "text", text: "Short summary." };
    },
  });
  models.setDefault("chat", "default");
  const tool = createDocSummarizeTool(models);
  const exec = createExec(workspace);
  const raw = await tool.execute({ path: "hello.md" }, exec);
  expect(Object.keys(JSON.parse(raw))).toEqual(["status", "path", "summary"]);
  expect(JSON.parse(raw)).toEqual({
    status: "ok",
    path: "hello.md",
    summary: "Short summary.",
  });
  expect(JSON.parse(raw).summary).not.toContain("发展");
  expect(capturedTools).toEqual([]);
  expect(capturedSignal).toBe(exec.signal);
});

it("maps summarize failures without writing", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "flintloom-stool-"));
  writeFileSync(join(workspace, "hello.md"), "# Hello\n");
  writeFileSync(join(workspace, "x.bin"), Buffer.from([0, 1, 2, 3]));
  writeFileSync(join(workspace, "empty.md"), "");
  const models = new ModelRegistry();
  let calls = 0;
  models.registerChat("default", {
    async *stream() {
      calls += 1;
      yield { type: "text", text: "nope" };
    },
  });
  models.setDefault("chat", "default");
  const tool = createDocSummarizeTool(models);
  const exec = createExec(workspace);

  expect(await tool.execute({}, exec)).toBe("failed: missing path");
  expect(await tool.execute({ path: "nope.md" }, exec)).toBe("failed: not found");
  expect(await tool.execute({ path: "x.bin" }, exec)).toBe(
    "failed: unsupported type",
  );
  expect(await tool.execute({ path: "empty.md" }, exec)).toBe(
    "failed: empty text",
  );
  expect(await tool.execute({ path: ".env" }, exec)).toBe("failed: hidden");
  await expect(tool.execute({ path: "../x.md" }, exec)).rejects.toThrow(
    WorkspaceEscapeError,
  );
  mkdirSync(join(workspace, "adir"));
  expect(await tool.execute({ path: "adir" }, exec)).toBe("failed: not a file");
  writeFileSync(join(workspace, "huge.md"), Buffer.alloc(GENERATE_MAX_BYTES + 1, 0x61));
  expect(await tool.execute({ path: "huge.md" }, exec)).toBe("failed: too large");
  expect(calls).toBe(0);

  const noChat = createDocSummarizeTool(new ModelRegistry());
  const unread = await noChat.execute({ path: "hello.md" }, exec);
  expect(unread).toBe("failed: unreadable");
  expect(unread).not.toContain("未配置 chat");
});

it("returns aborted when the summarize signal is aborted", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "flintloom-stool-ab-"));
  const ac = new AbortController();
  ac.abort();
  const tool = createDocSummarizeTool(new ModelRegistry());
  expect(
    await tool.execute({ path: "a.md" }, createExec(workspace, ac.signal)),
  ).toBe("aborted");
});
```

`plugin.test.ts`：第一个测试增加 `expect(names).toContain("doc_summarize");`。再追加：

```ts
it("registers doc_summarize and drops it on stop", () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), "flintloom-docforge-kb-")), "k.sqlite");
  const ctx = new Context();
  ctx.plugin(modelsPlugin);
  ctx.plugin(toolsPlugin);
  ctx.plugin(knowledgePlugin, { dbPath });
  const stop = ctx.plugin(plugin);
  const names = ctx.require<ToolRegistry>("tools").schemas().map((s) => s.name);
  expect(names).toContain("doc_summarize");
  stop();
  expect(ctx.require<ToolRegistry>("tools").schemas().map((s) => s.name)).not.toContain(
    "doc_summarize",
  );
});

it("apply without models throws models", () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), "flintloom-docforge-kb-")), "k.sqlite");
  const ctx = new Context();
  ctx.plugin(toolsPlugin);
  ctx.plugin(knowledgePlugin, { dbPath });
  expect(() => ctx.plugin(plugin)).toThrow(/models/);
});
```

现有「apply without knowledge」仍只挂 models + tools，不要在那条里先挂 knowledge。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run packages/docforge/tests/tools.test.ts packages/docforge/tests/plugin.test.ts`

Expected: FAIL（无 `createDocSummarizeTool` 或 schema 无 `doc_summarize`）

- [ ] **Step 3: 写最小实现**

`tools.ts`：

1. `import type { ModelRegistry } from "@flintloom/models";`
2. `import { summarizeDocument } from "./summarize.ts";`
3. named export 增加 `createDocSummarizeTool`。
4. **不要**往 `FAIL_REASONS` 加新字符串。
5. 把 `createDocCompareTool` 的 description 里 `use doc_summarize later` 改成 `use doc_summarize`。
6. 在 `createDocCompareTool` 之后追加：

```ts
export function createDocSummarizeTool(models: ModelRegistry): ToolDefinition {
  return {
    name: "doc_summarize",
    description:
      "Summarize a workspace document by parsing it to markdown and asking the chat model. Returns JSON with a short summary. Pass path. Do not use this to rewrite files (use doc_edit or fs) or to compare (use doc_compare).",
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
        const result = await summarizeDocument(absPath, models, exec.signal);
        if (!result.ok) {
          if (result.reason === "aborted") {
            return "aborted";
          }
          return `failed: ${result.reason}`;
        }
        return JSON.stringify({
          status: "ok",
          path: pathRel,
          summary: result.summary,
        });
      } catch (err) {
        if (exec.signal.aborted) {
          return "aborted";
        }
        return failFromError(err);
      }
    },
  };
}
```

`index.ts`：

1. `import type { ModelRegistry } from "@flintloom/models";`
2. 从 `./tools.ts` 的 import / re-export 增加 `createDocSummarizeTool`。
3. `apply` 改为：

```ts
apply(ctx: Context) {
  const tools = ctx.require<ToolRegistry>("tools");
  const models = ctx.require<ModelRegistry>("models");
  const kb = ctx.require<KnowledgeService>("knowledge");
  ctx.effect(tools.register(createDocProbeTool()));
  ctx.effect(tools.register(createDocParseTool()));
  ctx.effect(tools.register(createDocConvertTool()));
  ctx.effect(tools.register(createDocGenerateTool()));
  ctx.effect(tools.register(createDocEditTool()));
  ctx.effect(tools.register(createDocCompareTool()));
  ctx.effect(tools.register(createDocSummarizeTool(models)));
  ctx.effect(tools.register(createDocIngestTool(kb)));
}
```

`apply` 里不要调用 `models.resolveChat()`。保留 Task 1 已加的 `summarizeDocument` 导出。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run packages/docforge/tests/tools.test.ts packages/docforge/tests/plugin.test.ts packages/docforge/tests/summarize.test.ts`

Expected: PASS。无 chat 时 plugin 测试仍能 `ctx.plugin(plugin)`（第一条登记测试）。

- [ ] **Step 5: Commit**

```bash
git add packages/docforge/src/tools.ts packages/docforge/src/index.ts packages/docforge/tests/tools.test.ts packages/docforge/tests/plugin.test.ts
git commit -m "feat: register doc_summarize on the docforge plugin"
```

---

### Task 3: host factory 扫描 + 去掉 docforge + 全量验收

**Files:**
- Modify: `apps/host/tests/server.test.ts`

**Interfaces:**
- Consumes: Task 2 的工具名 `doc_summarize`
- Produces: host `src` 不含 `createDocSummarizeTool`；yml 无 docforge 行则 schema 无该工具；默认 assembly 含 `doc_summarize`

本任务**只改测试**。不要改 `apps/host/src`。

- [ ] **Step 1: 写测试**

在 `host src does not import tool factories` 增加（放在 `createDocCompareTool` 那一行旁边）：

```ts
expect(src).not.toMatch(/createDocSummarizeTool/);
```

不要写 `/summarize/` 这类会误伤的正则。

现有 `omitting docforge from yml omits doc_generate` 增加：

```ts
expect(names).not.toContain("doc_summarize");
```

现有 `registers doc_probe and doc_parse tools` 增加：

```ts
expect(names).toContain("doc_summarize");
```

- [ ] **Step 2: 跑 host 测试**

Run: `pnpm exec vitest run apps/host/tests/server.test.ts`

Expected: PASS（若 ASSEMBLY replace 失败，修字符串使其与 `apps/host/tests/assembly.ts` 完全一致）。

- [ ] **Step 3: 确认无泄漏**

不要改那些目录。在 `apps/host/src`、`packages/loop/src`、`packages/session/src`、`apps/desktop/src` 搜索 `createDocSummarizeTool`、`summarizeDocument`，结果必须为空。`apps/host/src/files.ts` 仍可 import `parse`。不要改 `packages/models-chat`。

- [ ] **Step 4: 全量测试**

Run: `pnpm test`

Expected: 全部 PASS。不打真实 DashScope。

- [ ] **Step 5: Commit**

```bash
git add apps/host/tests/server.test.ts
git commit -m "test: omit docforge drops doc_summarize"
```

---

## Spec coverage

| Spec | Task |
|---|---|
| `summarizeDocument`；`SUMMARIZE_SYSTEM` 原文；`tools: []`；`signal` 原样下传 | 1 |
| empty / 空白 md 不调 stream；`failed:` 前缀正文仍走 stream | 1 |
| `binary.bin` → `unsupported type`；not found / not a file / 字节与字符上限 | 1 |
| 缺 chat → `unreadable`，无 `未配置 chat` | 1 |
| 4001 → slice 4000，无 `[truncated]` | 1 |
| 仅 `tool_call` / `error` 盖掉 partial；text+`tool_call` 成功 | 1 |
| stream 中 abort；CRLF → 内层 user 无 `\r` | 1 |
| `@flintloom/models` runtime 依赖 | 1 |
| 工具 JSON 键顺序；`path` 相对正斜杠；摘要不含全文 | 2 |
| missing path / hidden / 越界 / empty / 缺 chat / 入口 abort | 2 |
| `apply` 在 compare 与 ingest 之间；`stop()`；无 models 抛 `models`；apply 不 `resolveChat` | 2 |
| `doc_compare` description 去掉 later | 2 |
| host factory 扫描；yml 省略；默认 assembly 含工具 | 3 |
| 不改 preview / loop / session / desktop / ChatRequest / models-chat / `createRuntime` register | 全任务都不碰那些文件 |
