# FlintLoom 个人知识库 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 个人 SQLite 知识库作为插件启动：工作台能 Import/列表/搜索，Agent 能 `doc_ingest` / `knowledge_search`，命中只经 `tool/result` 进 session；`flint` 仍能跑完一轮对话。

**Architecture:** `@flintloom/knowledge` 打开 `homeDir/.flintloom/knowledge.sqlite` 并 `provide("knowledge")`、登记 `knowledge_search`。DocForge `require("knowledge")` 后登记 `doc_ingest`；UI Import 与工具共用 `ingestWorkspaceFile`。Host 用 `ctx.get("knowledge")` 挂三路由，禁止 import `@flintloom/knowledge`。不改 `runTurn`。

**Tech Stack:** Node `node:sqlite` `DatabaseSync`、现有 kernel 插件、Vitest、React 工作台。不引入 `better-sqlite3`、embedding、Cordis、dataagent-v3。

## Global Constraints

- 产品名 FlintLoom；包前缀 `@flintloom/*`；只绑 `127.0.0.1`。
- 不 import / submodule / 拷贝 dataagent-v3、deepseek-harness、Cordis。
- 禁止往 `createRuntime` 里 `register` 工具。新包必须 `apply`。
- `apps/host/src` 任意 `.ts` 不得出现 `@flintloom/knowledge`、`createDocIngestTool`（连 `import type` 也不要）。
- API key 不进 session log、SSE、yml、知识库 body / list JSON。
- 隐藏规则与预览相同：`.git` / `node_modules` / `dist` / `credentials`、`/^\.env(?!\.example$)/`、`extname === ".env"`。禁止只靠 `extname(".env")` 判断 `.env`。
- 入库前 `resolveInside`。隐藏路径、不存在、目录 **不写行**；parse 失败写 `status=failed`。
- 不改 `runTurn`；无自动 RAG；无删除 API；无 markdown 渲染。
- 测试只用临时 `homeDir` / `dbPath`，不写开发者真·家目录。
- Windows 提交指定文件；不要 `git add -A`。

Spec：`docs/superpowers/specs/2026-08-17-flintloom-knowledge-design.md`

## File map

```text
packages/tools/src/hidden.ts              # isHiddenRelPath
packages/tools/src/index.ts
packages/tools/tests/hidden.test.ts
apps/host/src/files.ts                    # 改 import；列表过滤改用 isHiddenRelPath
apps/host/tests/files.test.ts             # isHiddenRelPath 从 tools 引进

packages/knowledge/package.json
packages/knowledge/src/types.ts
packages/knowledge/src/store.ts           # openKnowledge：SQLite + FTS/LIKE
packages/knowledge/src/snippet.ts
packages/knowledge/src/tool.ts            # knowledge_search
packages/knowledge/src/index.ts           # default apply
packages/knowledge/tests/store.test.ts
packages/knowledge/tests/tool.test.ts
packages/knowledge/tests/plugin.test.ts

packages/docforge/src/ingest.ts           # ingestWorkspaceFile 共享管道
packages/docforge/src/tools.ts            # createDocIngestTool
packages/docforge/src/index.ts
packages/docforge/package.json            # 依赖 @flintloom/knowledge
packages/docforge/tests/ingest.test.ts
packages/docforge/tests/plugin.test.ts
packages/docforge/tests/tools.test.ts

flintloom.yml
package.json                              # devDependency @flintloom/knowledge
apps/host/src/server.ts                   # overlay dbPath；三路由
apps/host/src/knowledge.ts                # HTTP 适配，本地结构类型
apps/host/tests/assembly.ts
apps/host/tests/knowledge.test.ts
apps/host/tests/server.test.ts            # 扫描整个 src；schema 含新工具

apps/desktop/src/knowledge.ts             # fetch list/search/import
apps/desktop/src/KnowledgePane.tsx
apps/desktop/src/FilePane.tsx             # Files | Knowledge tabs + 记住选中文件
apps/desktop/src/app.css
apps/desktop/tests/App.test.tsx
```

默认 yml 在 `docforge` 前插入 `knowledge`。

---

### Task 1: `isHiddenRelPath` 迁到 `@flintloom/tools`

**Files:**
- Create: `packages/tools/src/hidden.ts`
- Create: `packages/tools/tests/hidden.test.ts`
- Modify: `packages/tools/src/index.ts`
- Modify: `apps/host/src/files.ts`
- Modify: `apps/host/tests/files.test.ts`

**Interfaces:**
- Consumes: 现有 host `isHiddenRelPath` 语义（见 spec 与 `files.ts`）
- Produces: `export function isHiddenRelPath(relPath: string): boolean`

- [ ] **Step 1: Write the failing test**

`packages/tools/tests/hidden.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isHiddenRelPath } from "../src/index.ts";

describe("isHiddenRelPath", () => {
  it("hides env and listed names but not .env.example", () => {
    expect(isHiddenRelPath(".env")).toBe(true);
    expect(isHiddenRelPath(".env.local")).toBe(true);
    expect(isHiddenRelPath("secret.env")).toBe(true);
    expect(isHiddenRelPath(".env.example")).toBe(false);
    expect(isHiddenRelPath("node_modules/pkg/x.js")).toBe(true);
    expect(isHiddenRelPath("docs/a.md")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/tools/tests/hidden.test.ts`

Expected: FAIL（`isHiddenRelPath` 未导出）

- [ ] **Step 3: Implement**

`packages/tools/src/hidden.ts`：从 `apps/host/src/files.ts` **原样搬** `HIDDEN_NAMES`、`isHiddenName`、`isHiddenRelPath`（含 `extname` import）。`isHiddenName` 不导出。

`packages/tools/src/index.ts` 增加：

```ts
export { isHiddenRelPath } from "./hidden.ts";
```

`apps/host/src/files.ts`：删除 `HIDDEN_NAMES` / `isHiddenName` / `isHiddenRelPath`。改为：

```ts
import { isHiddenRelPath, resolveInside } from "@flintloom/tools";
```

列表循环里 `if (isHiddenName(name))` 改为 `if (isHiddenRelPath(name))`。

`apps/host/tests/files.test.ts`：`isHiddenRelPath` 改从 `@flintloom/tools` import；保留 `relFromWorkspace` 从 `../src/files.ts`。`describe("isHiddenRelPath")` 可删（已在 tools 测），**保留** `relFromWorkspace` 那条与全部 HTTP 用例。

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run packages/tools/tests/hidden.test.ts apps/host/tests/files.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/tools/src/hidden.ts packages/tools/src/index.ts packages/tools/tests/hidden.test.ts apps/host/src/files.ts apps/host/tests/files.test.ts
git commit -m "refactor: share hidden path rules from tools"
```

---

### Task 2: SQLite store（ingest / list / search）

**Files:**
- Create: `packages/knowledge/package.json`
- Create: `packages/knowledge/src/types.ts`
- Create: `packages/knowledge/src/snippet.ts`
- Create: `packages/knowledge/src/store.ts`
- Create: `packages/knowledge/tests/store.test.ts`
- Modify: 仓库根 `package.json`（`devDependencies` 加 `"@flintloom/knowledge": "workspace:*"`）

**Interfaces:**
- Consumes: `node:sqlite` `DatabaseSync`
- Produces:

```ts
export type KnowledgeStatus = "ok" | "failed";

export type KnowledgeRecord = {
  id: number;
  path: string;
  title: string;
  status: KnowledgeStatus;
  ingestedAt: number;
  workspaceRoot: string;
  failReason?: string;
};

export type KnowledgeHit = {
  id: number;
  path: string;
  title: string;
  snippet: string;
  workspaceRoot: string;
};

export type KnowledgeIngestInput = {
  workspaceRoot: string;
  relPath: string;
  title: string;
  status: KnowledgeStatus;
  body: string;
  failReason?: string;
};

export type KnowledgeService = {
  ingest(input: KnowledgeIngestInput): KnowledgeRecord;
  search(q: string): KnowledgeHit[];
  list(): KnowledgeRecord[];
  close(): void;
};

export function openKnowledge(dbPath: string): KnowledgeService;
export function makeSnippet(body: string, q: string, limit?: number): string;
```

`list()` 最多 200，`ingested_at DESC`，不含 body。`search` 只 `status=ok`，最多 8 条；`q` 调用方保证已 trim 且长度 1–200。`ON CONFLICT DO UPDATE` **保留 id**。`status=ok` 同步 FTS；`failed` 从 FTS 删除该 rowid。

- [ ] **Step 1: Write the failing test**

`packages/knowledge/tests/store.test.ts`:

```ts
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openKnowledge } from "../src/store.ts";

function dbFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "flintloom-kb-"));
  return join(dir, "knowledge.sqlite");
}

describe("openKnowledge", () => {
  it("ingests markdown, searches body, and upserts same path with same id", () => {
    const kb = openKnowledge(dbFile());
    const ws = mkdtempSync(join(tmpdir(), "flintloom-kb-ws-"));
    const first = kb.ingest({
      workspaceRoot: ws,
      relPath: "notes/a.md",
      title: "Notes",
      status: "ok",
      body: "# Notes\nagent should ingest notes before answering\n",
    });
    expect(first.status).toBe("ok");
    expect(kb.list()[0]?.path).toBe("notes/a.md");
    const hits = kb.search("ingest notes");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.snippet).toContain("ingest");
    expect(hits[0]?.snippet).not.toContain("x".repeat(50));

    const second = kb.ingest({
      workspaceRoot: ws,
      relPath: "notes/a.md",
      title: "Notes v2",
      status: "ok",
      body: "# Notes v2\nupdated body unique-token-xyz\n",
    });
    expect(second.id).toBe(first.id);
    expect(kb.search("unique-token-xyz")).toHaveLength(1);
    expect(kb.search("ingest notes")).toHaveLength(0);
    kb.close();
  });

  it("does not return failed rows from search", () => {
    const kb = openKnowledge(dbFile());
    const ws = mkdtempSync(join(tmpdir(), "flintloom-kb-ws-"));
    const row = kb.ingest({
      workspaceRoot: ws,
      relPath: "empty.md",
      title: "empty.md",
      status: "failed",
      body: "",
      failReason: "empty text",
    });
    expect(kb.list().some((item) => item.id === row.id && item.status === "failed")).toBe(
      true,
    );
    expect(kb.search("empty")).toHaveLength(0);
    kb.close();
  });

  it("keeps two workspaces with the same rel_path as two rows", () => {
    const kb = openKnowledge(dbFile());
    const a = mkdtempSync(join(tmpdir(), "flintloom-kb-a-"));
    const b = mkdtempSync(join(tmpdir(), "flintloom-kb-b-"));
    kb.ingest({
      workspaceRoot: a,
      relPath: "README.md",
      title: "A",
      status: "ok",
      body: "alpha-only",
    });
    kb.ingest({
      workspaceRoot: b,
      relPath: "README.md",
      title: "B",
      status: "ok",
      body: "beta-only",
    });
    expect(kb.list()).toHaveLength(2);
    expect(kb.search("alpha-only")).toHaveLength(1);
    kb.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/knowledge/tests/store.test.ts`

Expected: FAIL（包不存在）

- [ ] **Step 3: Implement**

`packages/knowledge/package.json`:

```json
{
  "name": "@flintloom/knowledge",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@flintloom/kernel": "workspace:*",
    "@flintloom/tools": "workspace:*"
  },
  "devDependencies": {
    "@flintloom/models": "workspace:*"
  }
}
```

根 `package.json` `devDependencies` 加 `"@flintloom/knowledge": "workspace:*"`。然后 `pnpm install`。

`packages/knowledge/src/types.ts`：按 Interfaces 导出类型（含 `close`）。

`packages/knowledge/src/snippet.ts`:

```ts
export function makeSnippet(body: string, q: string, limit = 240): string {
  const idx = body.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) {
    return body.length > limit ? `${body.slice(0, limit)}…` : body;
  }
  const half = Math.max(0, Math.floor((limit - q.length) / 2));
  let start = Math.max(0, idx - half);
  let end = Math.min(body.length, start + limit);
  if (end - start < limit) {
    start = Math.max(0, end - limit);
  }
  const prefix = start > 0 ? "…" : "";
  const suffix = end < body.length ? "…" : "";
  return `${prefix}${body.slice(start, end)}${suffix}`;
}

export function escapeLike(q: string): string {
  return q.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

export function ftsLiteral(q: string): string {
  return `"${q.replaceAll('"', '""')}"`;
}
```

`packages/knowledge/src/store.ts` 要点：

- `mkdirSync(dirname(dbPath), { recursive: true })`
- `new DatabaseSync(dbPath)`
- `CREATE TABLE IF NOT EXISTS documents`（spec §5.2 原样）
- `let fts = false`；`try { db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(title, body, content='documents', content_rowid='id', tokenize='trigram')`) ; fts = true } catch { /* LIKE */ }`
- `ingest`：`INSERT … ON CONFLICT(workspace_root, rel_path) DO UPDATE SET title, status, fail_reason, ingested_at, body RETURNING id, workspace_root, rel_path, title, status, fail_reason, ingested_at`
- `ingested_at = Date.now()`
- FTS：先 `INSERT INTO documents_fts(documents_fts, rowid) VALUES('delete', id)`（忽略失败），若 `status==="ok"` 再 `INSERT INTO documents_fts(rowid, title, body) VALUES(id, title, body)`
- `list`：`SELECT id, workspace_root, rel_path, title, status, fail_reason, ingested_at FROM documents ORDER BY ingested_at DESC LIMIT 200` — **不要** SELECT body
- `search`：FTS 时 `SELECT d.id, d.workspace_root, d.rel_path, d.title, d.body FROM documents_fts f JOIN documents d ON d.id = f.rowid WHERE documents_fts MATCH ? AND d.status = 'ok' ORDER BY rank LIMIT 8`，参数 `ftsLiteral(q)`；否则 `WHERE status='ok' AND (title LIKE ? ESCAPE '\' OR body LIKE ? ESCAPE '\') ORDER BY ingested_at DESC LIMIT 8`，参数 `'%' + escapeLike(q) + '%'`
- 每条 hit 的 `snippet = makeSnippet(body, q)`；返回对象 **没有** `body`
- `close()` 调 `db.close()`
- 映射 `rel_path` → `path`，`fail_reason` 空则省略 `failReason`

`mapRow` 辅助避免重复。

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run packages/knowledge/tests/store.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/knowledge package.json pnpm-lock.yaml
git commit -m "feat: add sqlite knowledge store with search"
```

---

### Task 3: knowledge 插件 + `knowledge_search`

**Files:**
- Create: `packages/knowledge/src/tool.ts`
- Create: `packages/knowledge/src/index.ts`
- Create: `packages/knowledge/tests/tool.test.ts`
- Create: `packages/knowledge/tests/plugin.test.ts`

**Interfaces:**
- Consumes: `openKnowledge`、`ToolRegistry`、`ctx.plugin(plugin, { dbPath })`
- Produces:

```ts
export function createKnowledgeSearchTool(kb: KnowledgeService): ToolDefinition;
// default export FlintPlugin name "@flintloom/knowledge"
// apply: provide("knowledge"), effect(close), register knowledge_search
```

`config.dbPath` 为非空字符串则用它，否则 `join(homedir(), ".flintloom", "knowledge.sqlite")`。

工具：`q` 不是非空字符串或 trim 后空或 `trim().length > 200` → `failed: missing q`。成功 `JSON.stringify({ q: trimmed, hits })`，hits 为 `{ id, path, title, snippet }`（**去掉** `workspaceRoot`）。`signal.aborted` → `aborted`。

- [ ] **Step 1: Write the failing tests**

`packages/knowledge/tests/tool.test.ts`:

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openKnowledge } from "../src/store.ts";
import { createKnowledgeSearchTool } from "../src/tool.ts";

function exec(workspaceRoot: string, signal = new AbortController().signal) {
  return { workspaceRoot, signal, channel: "cli" };
}

describe("knowledge_search", () => {
  it("returns hits without the full body and rejects empty q", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-kb-tool-"));
    const kb = openKnowledge(join(dir, "k.sqlite"));
    const body = `hello ${"x".repeat(80)} unique-search-token`;
    kb.ingest({
      workspaceRoot: dir,
      relPath: "a.md",
      title: "A",
      status: "ok",
      body,
    });
    const tool = createKnowledgeSearchTool(kb);
    const parsed = JSON.parse(
      await tool.execute({ q: "unique-search-token" }, exec(dir)),
    ) as { hits: { snippet: string }[] };
    expect(parsed.hits[0]?.snippet).toContain("unique-search-token");
    expect(parsed.hits[0]?.snippet).not.toBe(body);
    expect(JSON.stringify(parsed)).not.toContain("workspaceRoot");
    expect(await tool.execute({ q: "  " }, exec(dir))).toBe("failed: missing q");
    kb.close();
  });
});
```

`packages/knowledge/tests/plugin.test.ts`:

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Context } from "@flintloom/kernel";
import modelsPlugin from "@flintloom/models";
import toolsPlugin, { type ToolRegistry } from "@flintloom/tools";
import plugin from "../src/index.ts";
import type { KnowledgeService } from "../src/types.ts";

describe("knowledge plugin", () => {
  it("registers knowledge_search and stop() closes the store", () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "flintloom-kb-plug-")), "k.sqlite");
    const ctx = new Context();
    ctx.plugin(modelsPlugin);
    ctx.plugin(toolsPlugin);
    const stop = ctx.plugin(plugin, { dbPath });
    const tools = ctx.require<ToolRegistry>("tools");
    expect(tools.schemas().map((s) => s.name)).toContain("knowledge_search");
    const kb = ctx.require<KnowledgeService>("knowledge");
    stop();
    expect(tools.schemas().map((s) => s.name)).not.toContain("knowledge_search");
    expect(() =>
      kb.ingest({
        workspaceRoot: dbPath,
        relPath: "a.md",
        title: "a",
        status: "ok",
        body: "hi",
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run packages/knowledge/tests/tool.test.ts packages/knowledge/tests/plugin.test.ts`

Expected: FAIL

- [ ] **Step 3: Implement**

`tool.ts`：`createKnowledgeSearchTool` 如 Interfaces。`execute` 里 `kb.search(trimmed)` 后 `hits.map(({ workspaceRoot, ...rest }) => rest)`。

`index.ts`:

```ts
import { homedir } from "node:os";
import { join } from "node:path";
import type { Context, FlintPlugin } from "@flintloom/kernel";
import type { ToolRegistry } from "@flintloom/tools";
import { openKnowledge } from "./store.ts";
import { createKnowledgeSearchTool } from "./tool.ts";

function dbPathFromConfig(config: Record<string, unknown>): string {
  return typeof config.dbPath === "string" && config.dbPath.length > 0
    ? config.dbPath
    : join(homedir(), ".flintloom", "knowledge.sqlite");
}

const plugin: FlintPlugin = {
  name: "@flintloom/knowledge",
  apply(ctx: Context, config: Record<string, unknown>) {
    const kb = openKnowledge(dbPathFromConfig(config));
    ctx.provide("knowledge", kb);
    ctx.effect(() => {
      kb.close();
    });
    const tools = ctx.require<ToolRegistry>("tools");
    ctx.effect(tools.register(createKnowledgeSearchTool(kb)));
  },
};

export type {
  KnowledgeHit,
  KnowledgeIngestInput,
  KnowledgeRecord,
  KnowledgeService,
  KnowledgeStatus,
} from "./types.ts";
export { openKnowledge } from "./store.ts";
export { createKnowledgeSearchTool } from "./tool.ts";
export default plugin;
```

`apply` 必须先 `require("tools")` 再 register（yml 里 knowledge 在 tools 之后）。`provide` 可在 require 前后，但缺 tools 应拒绝启动——先 `require("tools")`。

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run packages/knowledge`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/knowledge
git commit -m "feat: register knowledge_search from knowledge plugin"
```

---

### Task 4: `ingestWorkspaceFile` + `doc_ingest`

**Files:**
- Create: `packages/docforge/src/ingest.ts`
- Create: `packages/docforge/tests/ingest.test.ts`
- Modify: `packages/docforge/src/tools.ts`
- Modify: `packages/docforge/src/index.ts`
- Modify: `packages/docforge/package.json`
- Modify: `packages/docforge/tests/plugin.test.ts`
- Modify: `packages/docforge/tests/tools.test.ts`

**Interfaces:**
- Consumes: `parse`、`resolveInside`、`isHiddenRelPath`、`KnowledgeService`
- Produces:

```ts
export type IngestOutcome =
  | { kind: "aborted" }
  | { kind: "missing_path" }
  | { kind: "hidden"; path: string }
  | { kind: "not_found" }
  | { kind: "not_a_file" }
  | { kind: "written"; record: KnowledgeRecord };

export async function ingestWorkspaceFile(
  kb: KnowledgeService,
  workspaceRoot: string,
  inputPath: string | undefined,
  signal?: AbortSignal,
): Promise<IngestOutcome>;
// 越界仍 throw WorkspaceEscapeError

export function createDocIngestTool(kb: KnowledgeService): ToolDefinition;
```

管道顺序严格按 spec §5.3。`failReason`：`parsed.slice("failed: ".length)`。title：`/^#\s+(.+)$/m` 捕获 trim，否则 basename（`relPath` 最后一段）。`workspaceRoot` 存 `realpathSync.native(workspaceRoot)`。`relPath` 用 `relative(realRoot, absPath).replaceAll("\\", "/")`。

工具映射：`aborted` / `failed: missing path` / `failed: hidden` / `failed: not found` / `failed: not a file`；`written` 则 `JSON.stringify({ status, id, path, title, failReason? })`。

- [ ] **Step 1: Write the failing tests**

`packages/docforge/tests/ingest.test.ts`:

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openKnowledge } from "@flintloom/knowledge";
import { WorkspaceEscapeError } from "@flintloom/tools";
import { ingestWorkspaceFile } from "../src/ingest.ts";
import { createDocIngestTool } from "../src/tools.ts";

describe("ingestWorkspaceFile", () => {
  it("ingests md, hides env, skips missing, and upserts", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-ingest-ws-"));
    const kb = openKnowledge(
      join(mkdtempSync(join(tmpdir(), "flintloom-ingest-db-")), "k.sqlite"),
    );
    writeFileSync(join(workspace, "README.md"), "# Hello\nbody token\n");
    writeFileSync(join(workspace, ".env"), "sk-secret\n");
    mkdirSync(join(workspace, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(workspace, "node_modules", "pkg", "x.js"), "1");
    writeFileSync(join(workspace, ".env.example"), "# Example\nvisible\n");

    const ok = await ingestWorkspaceFile(kb, workspace, "README.md");
    expect(ok.kind).toBe("written");
    if (ok.kind === "written") {
      expect(ok.record.status).toBe("ok");
      expect(ok.record.title).toBe("Hello");
    }
    const again = await ingestWorkspaceFile(kb, workspace, "README.md");
    if (ok.kind === "written" && again.kind === "written") {
      expect(again.record.id).toBe(ok.record.id);
    }

    expect((await ingestWorkspaceFile(kb, workspace, ".env")).kind).toBe("hidden");
    expect(kb.list().some((row) => row.path === ".env")).toBe(false);
    expect(
      (await ingestWorkspaceFile(kb, workspace, "node_modules/pkg/x.js")).kind,
    ).toBe("hidden");
    const example = await ingestWorkspaceFile(kb, workspace, ".env.example");
    expect(example.kind).toBe("written");

    expect((await ingestWorkspaceFile(kb, workspace, "nope.md")).kind).toBe(
      "not_found",
    );
    writeFileSync(join(workspace, "empty.md"), "   \n");
    const failed = await ingestWorkspaceFile(kb, workspace, "empty.md");
    expect(failed.kind).toBe("written");
    if (failed.kind === "written") {
      expect(failed.record.status).toBe("failed");
      expect(kb.search("empty")).toHaveLength(0);
    }

    await expect(
      ingestWorkspaceFile(kb, workspace, "../x"),
    ).rejects.toThrow(WorkspaceEscapeError);

    const tool = createDocIngestTool(kb);
    expect(await tool.execute({}, { workspaceRoot: workspace, signal: new AbortController().signal, channel: "cli" })).toBe(
      "failed: missing path",
    );
    const ac = new AbortController();
    ac.abort();
    expect(
      await tool.execute(
        { path: "README.md" },
        { workspaceRoot: workspace, signal: ac.signal, channel: "cli" },
      ),
    ).toBe("aborted");
    kb.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/docforge/tests/ingest.test.ts`

Expected: FAIL

- [ ] **Step 3: Implement**

`package.json` dependencies 加 `"@flintloom/knowledge": "workspace:*"`。`pnpm install`。

`ingest.ts`：按 Interfaces 实现。`stat` 目录 → `not_a_file`；ENOENT → `not_found`。hidden 检查 **请求 path** 与 `relative(realRoot, absPath)` 两处。`parse` 结果 `startsWith("failed:")` → written failed，body `""`。

`tools.ts` 增加 `createDocIngestTool`。`index.ts` 的 `apply`：

```ts
const kb = ctx.require<KnowledgeService>("knowledge");
ctx.effect(tools.register(createDocProbeTool()));
ctx.effect(tools.register(createDocParseTool()));
ctx.effect(tools.register(createDocIngestTool(kb)));
```

named export `ingestWorkspaceFile`、`createDocIngestTool`。

`plugin.test.ts`：在 docforge 之前 `ctx.plugin(knowledgePlugin, { dbPath })`，断言 schema 含 `doc_ingest`。缺 knowledge 时：

```ts
it("apply without knowledge throws knowledge", () => {
  const ctx = new Context();
  ctx.plugin(modelsPlugin);
  ctx.plugin(toolsPlugin);
  expect(() => ctx.plugin(plugin)).toThrow(/knowledge/);
});
```

`tools.test.ts` 现有 probe/parse 用例保持；可加一行 `createDocIngestTool` 缺 path（可选，ingest.test 已覆盖）。

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run packages/docforge packages/knowledge`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/docforge packages/knowledge/package.json pnpm-lock.yaml
git commit -m "feat: add doc_ingest through shared DocForge pipeline"
```

（若 lock 无 knowledge 变化可略）

---

### Task 5: yml overlay + host 三路由

**Files:**
- Modify: `flintloom.yml`
- Modify: `apps/host/tests/assembly.ts`
- Modify: `apps/host/src/server.ts`
- Create: `apps/host/src/knowledge.ts`
- Create: `apps/host/tests/knowledge.test.ts`
- Modify: `apps/host/tests/server.test.ts`

**Interfaces:**
- Consumes: `ctx.get` 结构类型（**不要** import `@flintloom/knowledge`）、`ingestWorkspaceFile` from `@flintloom/docforge`、`normalizeRelPath`、`WorkspaceEscapeError`
- Produces: HTTP 如 spec §5.5；`runtimeConfigById.knowledge = { dbPath: join(homeDir, ".flintloom", "knowledge.sqlite") }` **始终**设置（与 apiKey 无关）

本地类型（放 `knowledge.ts`，不要从 `@flintloom/knowledge` import）：

```ts
type KnowledgeRecord = {
  id: number;
  path: string;
  title: string;
  status: "ok" | "failed";
  ingestedAt: number;
  workspaceRoot: string;
  failReason?: string;
};
type KnowledgeHit = {
  id: number;
  path: string;
  title: string;
  snippet: string;
  workspaceRoot: string;
};
type KnowledgeService = {
  search(q: string): KnowledgeHit[];
  list(): KnowledgeRecord[];
};
```

import 路由 **不要**调 `kb.ingest`，调 `ingestWorkspaceFile(kb, workspaceRoot, rel)`。

`current`: `record.workspaceRoot === realpathSync.native(workspaceRoot)`。序列化删 `workspaceRoot`。

路由顺序：`GET /v1/knowledge/search` 先于 `GET /v1/knowledge`。`kb === undefined` → 404。

- [ ] **Step 1: Write the failing HTTP tests**

`apps/host/tests/knowledge.test.ts`:

```ts
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadOrCreateToken, startHost } from "../src/index.ts";
import { writeAssembly } from "./assembly.ts";

describe("knowledge HTTP", () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    if (close) {
      await close();
      close = undefined;
    }
  });

  async function start(): Promise<{
    url: string;
    token: string;
    workspaceRoot: string;
  }> {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-kb-http-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-kb-http-home-"));
    writeFileSync(join(workspaceRoot, "README.md"), "# Hello\nbody token\n");
    writeFileSync(join(workspaceRoot, ".env"), "sk-secret\n");
    writeAssembly(workspaceRoot);
    const host = await startHost({ workspaceRoot, homeDir, port: 0 });
    close = host.close;
    return { url: host.url, token: loadOrCreateToken(homeDir), workspaceRoot };
  }

  it("imports, lists, searches, upserts, and hides secrets", async () => {
    const { url, token, workspaceRoot } = await start();
    const auth = { Authorization: `Bearer ${token}` };
    const unauth = await fetch(`${url}/v1/knowledge`);
    expect(unauth.status).toBe(401);

    const imported = await fetch(`${url}/v1/knowledge/import`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ path: "README.md" }),
    });
    expect(imported.status).toBe(200);
    const first = (await imported.json()) as { id: number; status: string; title: string };
    expect(first.status).toBe("ok");
    expect(first.title).toBe("Hello");

    const listRes = await fetch(`${url}/v1/knowledge`, { headers: auth });
    const listText = await listRes.text();
    expect(listRes.status).toBe(200);
    expect(listText).not.toContain(realpathSync.native(workspaceRoot));
    const list = JSON.parse(listText) as {
      items: { path: string; current: boolean }[];
    };
    expect(list.items.some((row) => row.path === "README.md" && row.current)).toBe(true);

    const searchRes = await fetch(`${url}/v1/knowledge/search?q=body%20token`, {
      headers: auth,
    });
    const search = (await searchRes.json()) as { hits: { snippet: string }[] };
    expect(search.hits).toHaveLength(1);
    expect(search.hits[0]?.snippet).toContain("body token");

    const imported2 = await fetch(`${url}/v1/knowledge/import`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ path: "README.md" }),
    });
    expect(((await imported2.json()) as { id: number }).id).toBe(first.id);

    expect(
      (
        await fetch(`${url}/v1/knowledge/import`, {
          method: "POST",
          headers: { ...auth, "Content-Type": "application/json" },
          body: JSON.stringify({ path: "missing.md" }),
        })
      ).status,
    ).toBe(404);

    const hidden = await fetch(`${url}/v1/knowledge/import`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ path: ".env" }),
    });
    expect(hidden.status).toBe(200);
    const hiddenBody = (await hidden.json()) as { id?: number; failReason: string };
    expect(hiddenBody.failReason).toBe("hidden");
    expect(hiddenBody.id).toBeUndefined();
    const listAfter = (await (
      await fetch(`${url}/v1/knowledge`, { headers: auth })
    ).json()) as { items: { path: string }[] };
    expect(listAfter.items.some((row) => row.path === ".env")).toBe(false);

    expect((await fetch(`${url}/v1/knowledge/search`, { headers: auth })).status).toBe(400);
  });

  it("returns 404 when knowledge plugin is omitted", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-kb-nokb-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-kb-nokb-home-"));
    writeFileSync(
      join(workspaceRoot, "flintloom.yml"),
      `plugins:
  - id: models
    name: "@flintloom/models"
  - id: tools
    name: "@flintloom/tools"
  - id: session
    name: "@flintloom/session"
  - id: models-chat
    name: "@flintloom/models-chat"
  - id: loop
    name: "@flintloom/loop"
`,
    );
    const host = await startHost({ workspaceRoot, homeDir, port: 0 });
    close = host.close;
    const token = loadOrCreateToken(homeDir);
    const res = await fetch(`${host.url}/v1/knowledge`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
  });
});
```

`server.test.ts` 的 `host src does not import tool factories`：

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

it("host src does not import tool factories", () => {
  const srcDir = join(here, "../src");
  const src = readdirSync(srcDir)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => readFileSync(join(srcDir, name), "utf8"))
    .join("\n");
  expect(src).not.toMatch(/@flintloom\/fs/);
  expect(src).not.toMatch(/@flintloom\/grep/);
  expect(src).not.toMatch(/@flintloom\/shell/);
  expect(src).not.toMatch(/@flintloom\/models-chat/);
  expect(src).not.toMatch(/@flintloom\/knowledge/);
  expect(src).not.toMatch(/createDocProbeTool/);
  expect(src).not.toMatch(/createDocParseTool/);
  expect(src).not.toMatch(/createDocIngestTool/);
});
```

`registers doc_probe and doc_parse tools` 增加 `toContain("doc_ingest")` 与 `toContain("knowledge_search")`。

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run apps/host/tests/knowledge.test.ts apps/host/tests/server.test.ts`

Expected: FAIL（yml 无 knowledge / 无路由）

- [ ] **Step 3: Implement**

`flintloom.yml` 与 `ASSEMBLY` 在 shell 与 docforge 之间插入：

```yaml
  - id: knowledge
    name: "@flintloom/knowledge"
```

`createRuntime` 在 `runtimeConfigById` 初始化后 **无条件**：

```ts
runtimeConfigById.knowledge = {
  dbPath: join(homeDir, ".flintloom", "knowledge.sqlite"),
};
```

`apps/host/src/knowledge.ts`：

- `toPublicItem(row, workspaceRoot)` / `toPublicHit(hit, workspaceRoot)`
- `handleKnowledgeRequest(...)` 返回 `true` 表示已写响应，便于 `server.ts` 调用；或直接在 `server.ts` 里写三个 if。推荐独立函数以免 `server.ts` 再膨胀。

import：`normalizeRelPath` 失败 → 400。`ingestWorkspaceFile` 结果：

| kind | HTTP |
|---|---|
| missing_path | 400 |
| hidden | 200 `{ path, status: "failed", failReason: "hidden" }` |
| not_found | 404 |
| not_a_file | 400 `failed: not a file` |
| written | 200 `{ id, path, title, status, failReason? }` |

`WorkspaceEscapeError` → 400 `err.message`。

search：`q = url.searchParams.get("q")?.trim() ?? ""`；空 → 400。否则 `sendJson(200, { hits: kb.search(q).map(...) })`。

list：`{ items: kb.list().map(...) }`。

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run apps/host packages/docforge packages/knowledge packages/tools/tests/hidden.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add flintloom.yml apps/host package.json pnpm-lock.yaml
git commit -m "feat: expose knowledge HTTP routes from plugin context"
```

---

### Task 6: 工作台 Files | Knowledge

**Files:**
- Create: `apps/desktop/src/knowledge.ts`
- Create: `apps/desktop/src/KnowledgePane.tsx`
- Modify: `apps/desktop/src/FilePane.tsx`
- Modify: `apps/desktop/src/app.css`
- Modify: `apps/desktop/tests/App.test.tsx`

**Interfaces:**
- Consumes: 现有 `FilePane` 点文件 → `onInsertPath`；host JSON
- Produces: 右侧顶栏 tabs；Knowledge 页 search/list/import；未选文件 Import `disabled`

```ts
export type KnowledgeListItem = {
  id: number;
  path: string;
  title: string;
  status: "ok" | "failed";
  ingestedAt: number;
  current: boolean;
  failReason?: string;
};
export type KnowledgeHit = {
  id: number;
  path: string;
  title: string;
  snippet: string;
  current: boolean;
};

export async function fetchKnowledge(signal?: AbortSignal): Promise<{ items: KnowledgeListItem[] }>;
export async function searchKnowledge(q: string, signal?: AbortSignal): Promise<{ hits: KnowledgeHit[] }>;
export async function importKnowledge(path: string): Promise<unknown>;
```

非 2xx → throw（UI 显示 `host unreachable`）。

- [ ] **Step 1: Write the failing UI tests**

扩展 `installFetch`：若 URL 含 `/v1/knowledge/search` 或 `/v1/knowledge/import` 或 `/v1/knowledge`，默认：

- GET list → `{ items: [{ id: 1, path: "notes/a.md", title: "Notes", status: "ok", ingestedAt: 1, current: true }] }`
- GET search → `{ hits: [] }`
- POST import → `{ id: 1, path: "README.md", title: "Hello", status: "ok" }`

**必须把 knowledge 判断放在 `/v1/files` 之前**（否则 `includes("/v1/knowledge")` 没事，但 `/v1/files` 不会误伤）。`/v1/knowledge/search` 先于 `/v1/knowledge`。

新用例：

1. mount 后可见 `Files` 与 `Knowledge` 按钮；默认仍能看到 `README.md`（Files 页）。
2. 点 `Knowledge` → 出现 `notes/a.md`；Import 按钮 `disabled`（还没点过文件）。
3. 点回 `Files`，点 `README.md`，再点 `Knowledge`，点 Import → `fetch` 曾被以 `POST` 调用且 URL 含 `/v1/knowledge/import`，body JSON `path === "README.md"`。
4. Knowledge 页 `fetch` throw → 文案 `host unreachable`。

现有「shows file tree and preview」不得因缺 knowledge mock 而失败（默认 installFetch 已覆盖）。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run apps/desktop/tests/App.test.tsx`

Expected: FAIL（无 Knowledge tab / Import）

- [ ] **Step 3: Implement**

`knowledge.ts`：三个 fetch，与 `files.ts` 同样 `if (!res.ok) throw new Error("host unreachable")`。

`KnowledgePane.tsx` props：`{ selectedPath?: string }`。

- mount：`fetchKnowledge`
- input onChange：trim 空则 list，否则 `searchKnowledge`
- 列表按钮：`path · status`；`!current` 则追加「其它工作区」；失败显示 status
- 点中项：下方 `<pre>` 显示 `snippet` 或 `failReason` 或 `已入库`
- 底栏：`导入 {selectedPath}` + `<button disabled={!selectedPath}>Import</button>`
- Import：`importKnowledge(selectedPath)` 后重新 `fetchKnowledge`
- catch：`host unreachable`

`FilePane.tsx`：

- `const [tab, setTab] = useState<"files" | "knowledge">("files")`
- `const [selectedFile, setSelectedFile] = useState<string>()`
- `openFile` 里 `setSelectedFile(filePath)`（仅点文件，不要在初始 auto-preview 里 set）
- aside 顶部两个 button：`Files` / `Knowledge`
- `tab==="files"` 渲染现有 tree+preview；否则 `<KnowledgePane selectedPath={selectedFile} />`

`app.css`：`.side-tabs` 底边框；当前 tab 底边强调（可用 `#3a6ea5`）。Knowledge 列表可滚动；底栏 `border-top`。

- [ ] **Step 4: Run tests**

Run: `pnpm test`

Expected: 全绿（含既有 loop / files / desktop / host）

- [ ] **Step 5: Commit**

```bash
git add apps/desktop
git commit -m "feat: add workbench knowledge tab for import and search"
```

---

## Self-review

| Spec | Task |
|---|---|
| `isHiddenRelPath` 共享 | 1 |
| SQLite + FTS/LIKE + upsert 保 id | 2 |
| `knowledge_search` + plugin stop 关库 | 3 |
| 共享入库管道、hidden 不写行、`.env.example` 可入 | 4 |
| yml、`dbPath` overlay、三路由、`current`、host 不 import 包 | 5 |
| Files \| Knowledge UI | 6 |
| 不改 `runTurn` / 无 RAG / 无删除 | 约束，无任务改 loop |
| factory 扫描整个 `apps/host/src` | 5 |

无 TBD。后续任务使用的 `KnowledgeService` / `ingestWorkspaceFile` / `IngestOutcome` 与 Task 2–4 一致。
