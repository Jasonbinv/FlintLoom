# FlintLoom 信息图盒线核心 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agent 能 `infographic_get` / `infographic_patch` 读写工作区 `*.infographic.json`；Files 点该文件时预览是消毒 SVG，不是 JSON 源码。

**Architecture:** `@flintloom/infographic` 导出纯函数 `parseDocument` / `applyOps` / `renderSvg` / `isInfographicRelPath`，并 `apply` 登记两个工具。host `files.ts` 直接 import 纯函数做预览（yml 去掉插件仍出图）。桌面只显示 `{ kind: "svg" }` 的 `<img>`，不 import 该包。loop / session 不改。

**Tech Stack:** 现有 kernel 插件、Vitest、React 工作台。不引入 sanitizer 库、远程 icon、A2UI Infographic 组件。

## Global Constraints

- 产品名 FlintLoom；包前缀 `@flintloom/*`；只绑 `127.0.0.1`。
- 不 import / submodule / 拷贝 dataagent-v3、deepseek-harness、Cordis。
- 禁止往 `createRuntime` 里 `register` 工具。新包必须 `apply`。
- `apps/host/src` 不得出现 `createInfographicGetTool` / `createInfographicPatchTool`；**允许** import `@flintloom/infographic` 的纯函数。
- `packages/loop/src`、`packages/session/src` 不得出现 `@flintloom/infographic`。
- 字符串含 `http://` / `https://` → 失败。先 `stat.size` 再读盘；`> 65536` 字节 → `too large`。
- 路径判断只许调用 `isInfographicRelPath`，禁止复制 `endsWith`。
- Windows 提交指定文件；不要 `git add -A`。

Spec：`docs/superpowers/specs/2026-08-17-flintloom-infographic-design.md`

## File map

```text
packages/infographic/package.json
packages/infographic/src/types.ts
packages/infographic/src/path.ts          # isInfographicRelPath
packages/infographic/src/document.ts      # parseDocument, applyOps, MAX_BYTES
packages/infographic/src/render.ts        # renderSvg
packages/infographic/src/tool.ts
packages/infographic/src/index.ts
packages/infographic/tests/path.test.ts
packages/infographic/tests/document.test.ts
packages/infographic/tests/render.test.ts
packages/infographic/tests/tool.test.ts
packages/infographic/tests/plugin.test.ts

flintloom.yml
package.json
pnpm-lock.yaml
apps/host/package.json
apps/host/src/files.ts
apps/host/tests/assembly.ts
apps/host/tests/infographic.test.ts
apps/host/tests/server.test.ts

apps/desktop/src/files.ts
apps/desktop/src/FilePane.tsx
apps/desktop/src/app.css
apps/desktop/tests/App.test.tsx
```

默认 yml 在 `docforge` 与 `a2ui` 之间插入 `infographic`。

各测试文件内各自定义 `twoNodeDoc()`，不要跨包 import 测试文件：

```ts
function twoNodeDoc() {
  return {
    nodes: [
      { id: "parse", label: "Parse", x: 20, y: 40 },
      { id: "kb", label: "KB", x: 200, y: 40 },
    ],
    edges: [{ from: "parse", to: "kb" }],
  };
}
```

---

### Task 1: parse / apply / render 纯函数

**Files:**
- Create: `packages/infographic/package.json`
- Create: `packages/infographic/src/types.ts`
- Create: `packages/infographic/src/path.ts`
- Create: `packages/infographic/src/document.ts`
- Create: `packages/infographic/src/render.ts`
- Create: `packages/infographic/tests/path.test.ts`
- Create: `packages/infographic/tests/document.test.ts`
- Create: `packages/infographic/tests/render.test.ts`
- Modify: 仓库根 `package.json`（`devDependencies` 加 `"@flintloom/infographic": "workspace:*"`）

**Interfaces:**
- Consumes: 无
- Produces:

```ts
export const INFOGRAPHIC_MAX_BYTES = 65536;

export type InfographicNode = {
  id: string;
  label: string;
  x: number;
  y: number;
};
export type InfographicEdge = {
  from: string;
  to: string;
  label?: string;
};
export type InfographicDocument = {
  nodes: InfographicNode[];
  edges: InfographicEdge[];
};
export type InfographicOp =
  | { op: "addNode"; id: string; label: string; x: number; y: number }
  | { op: "updateNode"; id: string; label?: string; x?: number; y?: number }
  | { op: "removeNode"; id: string }
  | { op: "addEdge"; from: string; to: string; label?: string }
  | { op: "removeEdge"; from: string; to: string };

export function isInfographicRelPath(relPath: string): boolean;
export function parseDocument(raw: string): InfographicDocument;
export function applyOps(doc: InfographicDocument, ops: unknown): InfographicDocument;
export function renderSvg(doc: InfographicDocument): string;
```

- [ ] **Step 1: Write the failing tests**

`packages/infographic/tests/path.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { isInfographicRelPath } from "../src/path.ts";

describe("isInfographicRelPath", () => {
  it("matches suffix case-insensitively and rejects plain json", () => {
    expect(isInfographicRelPath("flow.infographic.json")).toBe(true);
    expect(isInfographicRelPath("Foo.Infographic.JSON")).toBe(true);
    expect(isInfographicRelPath("docs\\a.infographic.json")).toBe(true);
    expect(isInfographicRelPath("notes.json")).toBe(false);
    expect(isInfographicRelPath("flow.infographic.json.bak")).toBe(false);
  });
});
```

`packages/infographic/tests/document.test.ts`：贴 `twoNodeDoc`。然后：

```ts
import { describe, expect, it } from "vitest";
import { applyOps, parseDocument } from "../src/document.ts";

describe("parseDocument", () => {
  it("accepts a two-node graph", () => {
    const doc = twoNodeDoc();
    expect(parseDocument(JSON.stringify(doc))).toEqual(doc);
  });

  it("rejects missing id, duplicate id, dangling edge, https, and oversized payload", () => {
    expect(() => parseDocument("{")).toThrow(/bad json/);
    expect(() => parseDocument(JSON.stringify({ nodes: [], edges: [] }))).not.toThrow();
    expect(() =>
      parseDocument(
        JSON.stringify({
          nodes: [{ id: "a", label: "A", x: 0, y: 0 }],
          edges: [{ from: "a", to: "missing" }],
        }),
      ),
    ).toThrow(/unknown node/);
    expect(() =>
      parseDocument(
        JSON.stringify({
          nodes: [
            { id: "a", label: "A", x: 0, y: 0 },
            { id: "a", label: "B", x: 1, y: 1 },
          ],
          edges: [],
        }),
      ),
    ).toThrow(/duplicate id/);
    expect(() =>
      parseDocument(
        JSON.stringify({
          nodes: [{ id: "a", label: "see https://x.test", x: 0, y: 0 }],
          edges: [],
        }),
      ),
    ).toThrow(/remote url/);
    const huge = twoNodeDoc();
    huge.nodes[0]!.label = "x".repeat(70_000);
    expect(() => parseDocument(JSON.stringify(huge))).toThrow(/too large/);
  });
});

describe("applyOps", () => {
  it("adds, updates, and removes without mutating the input", () => {
    const empty = { nodes: [], edges: [] };
    const frozen = { nodes: [], edges: [] };
    const added = applyOps(empty, [
      { op: "addNode", id: "parse", label: "Parse", x: 20, y: 40 },
      { op: "addNode", id: "kb", label: "KB", x: 200, y: 40 },
      { op: "addEdge", from: "parse", to: "kb" },
    ]);
    expect(frozen).toEqual({ nodes: [], edges: [] });
    expect(added.edges).toEqual([{ from: "parse", to: "kb" }]);
    const renamed = applyOps(added, [{ op: "updateNode", id: "kb", label: "Store" }]);
    expect(renamed.nodes.find((n) => n.id === "kb")?.label).toBe("Store");
    expect(added.nodes.find((n) => n.id === "kb")?.label).toBe("KB");
    const removed = applyOps(renamed, [{ op: "removeNode", id: "parse" }]);
    expect(removed.nodes.map((n) => n.id)).toEqual(["kb"]);
    expect(removed.edges).toEqual([]);
  });

  it("throws unknown node and does not apply a later op", () => {
    const doc = twoNodeDoc();
    expect(() => applyOps(doc, [{ op: "updateNode", id: "nope", label: "x" }])).toThrow(
      /unknown node/,
    );
    expect(doc).toEqual(twoNodeDoc());
    expect(() => applyOps(doc, [])).toThrow(/empty ops/);
  });
});
```

`packages/infographic/tests/render.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { renderSvg } from "../src/render.ts";

describe("renderSvg", () => {
  it("emits escaped labels and no href or script", () => {
    const svg = renderSvg({
      nodes: [{ id: "a", label: "A&B", x: 0, y: 0 }],
      edges: [],
    });
    expect(svg).toContain("<svg");
    expect(svg).toContain("A&amp;B");
    expect(svg).not.toContain("A&B");
    expect(svg).not.toMatch(/href/i);
    expect(svg).not.toContain("<script");
    expect(svg).toContain("#e8e8e8");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run packages/infographic/tests`

Expected: FAIL（包不存在）

- [ ] **Step 3: Implement**

`packages/infographic/package.json`：

```json
{
  "name": "@flintloom/infographic",
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

根 `package.json` 加 `"@flintloom/infographic": "workspace:*"`。然后 `pnpm install`。

`path.ts`：`replaceAll("\\", "/")` 后 `toLowerCase()`，`endsWith(".infographic.json")`。

`document.ts` 要点：

- `INFOGRAPHIC_MAX_BYTES = 65536`
- `parseDocument`：字节长度超限 → `too large`；`JSON.parse` 失败 → `bad json`；顶层只许 `nodes`/`edges` 数组；节点字段恰好 `id,label,x,y`；边字段 `from,to` 或 `from,to,label`；id 匹配 `/^[A-Za-z0-9_-]+$/`；`Number.isFinite(x/y)`；递归字符串含 `http://` 或 `https://` → `remote url`；重复 id / 重复 `(from,to)` / 边端点不在 nodes → 对应短英文。
- `applyOps`：拷贝 nodes/edges；按序处理；规则见 spec §5.2；最后 `return parseDocument(JSON.stringify(next, null, 2) + "\n")` 以复用体积与文档规则。

`render.ts`：节点 `120×40`，padding `24`，空图 viewBox `0 0 200 80`。`rect` fill `#1a1a1a` stroke `#e8e8e8`；`text` / `line` / `polygon` 用 `#e8e8e8`。XML 转义 `& < > "`。边画在节点之前。无 `href`/`script`/`style`/`use`/`foreignObject`。

Task 1 的 `index.ts` 只 re-export 这些函数和类型（插件下一任务再加）。

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run packages/infographic/tests/path.test.ts packages/infographic/tests/document.test.ts packages/infographic/tests/render.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/infographic package.json pnpm-lock.yaml
git commit -m "feat: add infographic document parser and svg renderer"
```

---

### Task 2: 插件 + get / patch 工具

**Files:**
- Create: `packages/infographic/src/tool.ts`
- Modify: `packages/infographic/src/index.ts`
- Create: `packages/infographic/tests/tool.test.ts`
- Create: `packages/infographic/tests/plugin.test.ts`

**Interfaces:**
- Consumes: `parseDocument`、`applyOps`、`isInfographicRelPath`、`resolveInside`、`isHiddenRelPath`
- Produces: `createInfographicGetTool()` / `createInfographicPatchTool()`；default plugin `name: "@flintloom/infographic"`

工具共用：abort → `aborted`；缺 path → `failed: missing path`；`resolveInside`；隐藏（`inputPath` 或 resolve 后 rel，与 `ingestWorkspaceFile` 相同）→ `failed: hidden`；`!isInfographicRelPath(relPath)` → `failed: bad path`。ENOENT：get 为 `not found`；patch 若 ops 含 `addNode` 则从空文档 apply，否则 `not found`。目录 → `not a file`。`stat.size > 65536` → `too large`。父目录不存在（write ENOENT）→ `failed: not found`。不要 `mkdir`。

get 成功：`JSON.stringify(doc)` 紧凑。patch 成功：`JSON.stringify({ status: "ok", path: relPath, nodes: doc.nodes.length, edges: doc.edges.length })`，写出 `JSON.stringify(doc, null, 2) + "\n"`。校验失败：`failed: ${err.message}`，不写。

- [ ] **Step 1: Write the failing tests**

`packages/infographic/tests/tool.test.ts`：

```ts
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WorkspaceEscapeError } from "@flintloom/tools";
import { createInfographicGetTool, createInfographicPatchTool } from "../src/tool.ts";

const exec = (workspaceRoot: string) => ({
  workspaceRoot,
  signal: new AbortController().signal,
  channel: "cli",
});

describe("infographic tools", () => {
  it("gets, patches, creates, and rejects bad path / abort / escape", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-ig-"));
    const get = createInfographicGetTool();
    const patch = createInfographicPatchTool();
    const e = exec(workspace);

    expect(await get.execute({ path: "notes.json" }, e)).toBe("failed: bad path");
    expect(await get.execute({ path: "flow.infographic.json" }, e)).toBe("failed: not found");

    const created = await patch.execute(
      {
        path: "flow.infographic.json",
        ops: [
          { op: "addNode", id: "parse", label: "Parse", x: 20, y: 40 },
          { op: "addNode", id: "kb", label: "KB", x: 200, y: 40 },
          { op: "addEdge", from: "parse", to: "kb" },
        ],
      },
      e,
    );
    expect(JSON.parse(created)).toEqual({
      status: "ok",
      path: "flow.infographic.json",
      nodes: 2,
      edges: 1,
    });
    const got = JSON.parse(await get.execute({ path: "flow.infographic.json" }, e));
    expect(got.nodes[1].label).toBe("KB");
    expect(await get.execute({ path: "flow.infographic.json" }, e)).not.toContain("<svg");

    const before = readFileSync(join(workspace, "flow.infographic.json"), "utf8");
    expect(await patch.execute({ path: "flow.infographic.json", ops: [] }, e)).toMatch(
      /^failed:/,
    );
    expect(readFileSync(join(workspace, "flow.infographic.json"), "utf8")).toBe(before);

    expect(
      await patch.execute(
        {
          path: "no-such-dir/x.infographic.json",
          ops: [{ op: "addNode", id: "a", label: "A", x: 0, y: 0 }],
        },
        e,
      ),
    ).toBe("failed: not found");

    const ac = new AbortController();
    ac.abort();
    expect(
      await get.execute({ path: "flow.infographic.json" }, { ...e, signal: ac.signal }),
    ).toBe("aborted");

    await expect(get.execute({ path: "../x.infographic.json" }, e)).rejects.toThrow(
      WorkspaceEscapeError,
    );
  });
});
```

`packages/infographic/tests/plugin.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { Context } from "@flintloom/kernel";
import modelsPlugin from "@flintloom/models";
import toolsPlugin, { type ToolRegistry } from "@flintloom/tools";
import plugin from "../src/index.ts";

describe("infographic plugin", () => {
  it("registers get/patch and stop() unregisters them", () => {
    const ctx = new Context();
    ctx.plugin(modelsPlugin);
    ctx.plugin(toolsPlugin);
    const stop = ctx.plugin(plugin);
    const tools = ctx.require<ToolRegistry>("tools");
    const names = tools.schemas().map((s) => s.name);
    expect(names).toContain("infographic_get");
    expect(names).toContain("infographic_patch");
    const svc = ctx.require<{ parseDocument: (raw: string) => unknown }>("infographic");
    expect(typeof svc.parseDocument).toBe("function");
    stop();
    expect(tools.schemas().map((s) => s.name)).not.toContain("infographic_get");
    expect(tools.schemas().map((s) => s.name)).not.toContain("infographic_patch");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run packages/infographic/tests/tool.test.ts packages/infographic/tests/plugin.test.ts`

Expected: FAIL

- [ ] **Step 3: Implement**

`tool.ts`：两个 `ToolDefinition`，`execute` 如 Interfaces。ENOENT 用 `err.code === "ENOENT"`。`relPath` 用 `relative(realpathSync.native(workspaceRoot), absPath).replaceAll("\\", "/")`（空则 `"."` 不适用文件）。

`index.ts`：default plugin 如 spec §5.5；并 export Task 1 的函数与两个 create*Tool。

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run packages/infographic`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/infographic
git commit -m "feat: register infographic_get and infographic_patch"
```

---

### Task 3: yml + host 预览 `kind: "svg"`

**Files:**
- Modify: `flintloom.yml`
- Modify: `apps/host/tests/assembly.ts`
- Modify: `apps/host/package.json`（`dependencies` 加 `"@flintloom/infographic": "workspace:*"`）
- Modify: `apps/host/src/files.ts`
- Create: `apps/host/tests/infographic.test.ts`
- Modify: `apps/host/tests/server.test.ts`

**Interfaces:**
- Consumes: `isInfographicRelPath`、`parseDocument`、`renderSvg`
- Produces: `FilePreview.kind` 含 `"svg"`；后缀分支在 DocForge 与文本预览之前

- [ ] **Step 1: Write the failing HTTP tests**

`apps/host/tests/infographic.test.ts`：

```ts
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type ToolRegistry } from "@flintloom/tools";
import { createRuntime, loadOrCreateToken, startHost } from "../src/index.ts";
import { writeAssembly } from "./assembly.ts";

function twoNodeDoc() {
  return {
    nodes: [
      { id: "parse", label: "Parse", x: 20, y: 40 },
      { id: "kb", label: "KB", x: 200, y: 40 },
    ],
    edges: [{ from: "parse", to: "kb" }],
  };
}

describe("infographic preview HTTP", () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    if (close) {
      await close();
      close = undefined;
    }
  });

  it("returns svg for infographic json and text for plain json", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-ig-http-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-ig-http-home-"));
    writeAssembly(workspaceRoot);
    writeFileSync(
      join(workspaceRoot, "flow.infographic.json"),
      JSON.stringify(twoNodeDoc(), null, 2) + "\n",
    );
    writeFileSync(join(workspaceRoot, "notes.json"), '{"ok":true}\n');
    writeFileSync(join(workspaceRoot, "bad.infographic.json"), "{");
    const host = await startHost({ workspaceRoot, homeDir, port: 0 });
    close = host.close;
    const token = loadOrCreateToken(homeDir);
    const headers = { Authorization: `Bearer ${token}` };

    const svg = await fetch(`${host.url}/v1/files/preview?path=flow.infographic.json`, { headers });
    expect(svg.status).toBe(200);
    const svgBody = (await svg.json()) as { kind: string; text: string };
    expect(svgBody.kind).toBe("svg");
    expect(svgBody.text).toContain("<svg");
    expect(svgBody.text).toContain("Parse");

    const plain = await fetch(`${host.url}/v1/files/preview?path=notes.json`, { headers });
    const plainBody = (await plain.json()) as { kind: string; text: string };
    expect(plainBody.kind).toBe("text");
    expect(plainBody.text).toContain('"ok"');

    const bad = await fetch(`${host.url}/v1/files/preview?path=bad.infographic.json`, { headers });
    const badBody = (await bad.json()) as { kind: string; text: string };
    expect(badBody.kind).toBe("failed");
    expect(badBody.text).toMatch(/^failed:/);
  });

  it("omitting the plugin drops tools but still previews svg", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-ig-omit-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-ig-omit-home-"));
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
    writeFileSync(
      join(workspaceRoot, "flow.infographic.json"),
      JSON.stringify(twoNodeDoc(), null, 2) + "\n",
    );
    const { ctx } = await createRuntime(workspaceRoot, homeDir);
    const names = ctx.require<ToolRegistry>("tools").schemas().map((s) => s.name);
    expect(names).not.toContain("infographic_get");
    expect(names).not.toContain("infographic_patch");

    const host = await startHost({ workspaceRoot, homeDir, port: 0 });
    close = host.close;
    const token = loadOrCreateToken(homeDir);
    const res = await fetch(`${host.url}/v1/files/preview?path=flow.infographic.json`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await res.json()) as { kind: string; text: string };
    expect(body.kind).toBe("svg");
    expect(body.text).toContain("<svg");
  });
});
```

`server.test.ts` factory 扫描增加：

```ts
expect(src).not.toMatch(/createInfographicGetTool/);
expect(src).not.toMatch(/createInfographicPatchTool/);
```

**不要** `not.toMatch(/@flintloom\/infographic/)`。

`registers doc_probe...` 增加 `toContain("infographic_get")` 与 `toContain("infographic_patch")`。

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run apps/host/tests/infographic.test.ts apps/host/tests/server.test.ts`

Expected: FAIL

- [ ] **Step 3: Implement**

`flintloom.yml` 与 `ASSEMBLY` 在 docforge 与 a2ui 之间插入：

```yaml
  - id: infographic
    name: "@flintloom/infographic"
```

`apps/host/package.json` dependencies 加 `"@flintloom/infographic": "workspace:*"`，`pnpm install`。

`files.ts`：`FilePreview.kind` 加 `"svg"`。在目录检查之后、`detectType` 之前：

```ts
  if (isInfographicRelPath(relPath)) {
    if (st.size > 65536) {
      return { path: relPath, kind: "failed", text: "failed: too large" };
    }
    try {
      const raw = bytes.toString("utf8");
      const svg = renderSvg(parseDocument(raw));
      return { path: relPath, kind: "svg", text: svg };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { path: relPath, kind: "failed", text: `failed: ${message}` };
    }
  }
```

注意：当前函数是先 `readFile` 再 `detectType`。对 infographic **不要**为了 64KiB 去解析超大 buffer 当 JSON，但 `readFile` 已经发生。按 spec：先 `stat`（已有 `st`），若 `isInfographicRelPath` 且 `st.size > 65536`，**不要 readFile**。把 infographic 分支挪到 `const bytes = await readFile` **之前**（仍在「是文件」之后）：

```ts
  if (isInfographicRelPath(relPath)) {
    if (st.size > 65536) {
      return { path: relPath, kind: "failed", text: "failed: too large" };
    }
    const raw = (await readFile(absPath)).toString("utf8");
    try {
      return { path: relPath, kind: "svg", text: renderSvg(parseDocument(raw)) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { path: relPath, kind: "failed", text: `failed: ${message}` };
    }
  }

  const bytes = await readFile(absPath);
  // existing detectType / text branches
```

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run apps/host packages/infographic`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add flintloom.yml apps/host package.json pnpm-lock.yaml
git commit -m "feat: preview infographic json as svg"
```

（若根 `package.json` / lock 在 Task 1 已提交且 Task 3 只改 host package.json，则不要重复 add 根 package.json。）

---

### Task 4: FilePane 用 `<img>` 显示 SVG

**Files:**
- Modify: `apps/desktop/src/files.ts`
- Modify: `apps/desktop/src/FilePane.tsx`
- Modify: `apps/desktop/src/app.css`
- Modify: `apps/desktop/tests/App.test.tsx`

**Interfaces:**
- Consumes: `FilePreview.kind === "svg"`
- Produces: 预览区 `<img>`；`text`/`markdown`/`failed` 仍 `<pre>`

- [ ] **Step 1: Write the failing UI test**

在 `App.test.tsx` 追加（`installFetch` 可覆盖 `files` 与 `preview`）：

```ts
  it("renders infographic preview as an image without json source", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><text>Parse</text></svg>`;
    installFetch({
      files: new Response(
        JSON.stringify({
          path: ".",
          entries: [{ name: "flow.infographic.json", type: "file" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
      preview: new Response(
        JSON.stringify({
          path: "flow.infographic.json",
          kind: "svg",
          text: svg,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    });
    await mountApp();
    await waitForText("flow.infographic.json");
    const fileButton = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "flow.infographic.json",
    );
    if (!fileButton) throw new Error("no infographic button");
    await act(async () => {
      fileButton.click();
    });
    const img = document.querySelector("img");
    if (!img) throw new Error("no preview img");
    expect(img.getAttribute("alt")).toBe("flow.infographic.json");
    expect(img.getAttribute("src") ?? "").toContain("data:image/svg+xml");
    expect(img.getAttribute("src") ?? "").toContain(encodeURIComponent("<svg"));
    expect(document.querySelector("pre.file-preview")?.textContent ?? "").not.toContain(
      `"kind":"svg"`,
    );
    expect(document.body.textContent).not.toContain('"nodes"');
  });
```

现有 README 预览用例不得因 `kind` 联合类型失败。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run apps/desktop/tests/App.test.tsx`

Expected: FAIL（仍是 `<pre>`，无 `img`）

- [ ] **Step 3: Implement**

`files.ts`：`kind: "markdown" | "text" | "failed" | "svg"`。

`FilePane.tsx`：增加 `previewKind` state。`loadPreview` 里 `setPreviewKind(preview.kind)` 且 `setPreviewText(preview.text)`。渲染：

```tsx
{previewKind === "svg" && !previewError ? (
  <div className="file-preview file-preview-svg">
    <img
      alt={selectedFile ?? ""}
      src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(previewText)}`}
    />
  </div>
) : (
  <pre className="file-preview">
    {previewError ? "host unreachable" : previewText}
  </pre>
)}
```

`app.css`：

```css
.file-preview-svg img {
  max-width: 100%;
  height: auto;
  display: block;
}
```

点文件仍 `onInsertPath`。不改 Knowledge。

- [ ] **Step 4: Run tests**

Run: `pnpm test`

Expected: 全绿（当前基线 38 files / 153 tests，本片会增加文件与用例）

- [ ] **Step 5: Commit**

```bash
git add apps/desktop
git commit -m "feat: show infographic svg in the files preview pane"
```

---

## Self-review

| Spec | Task |
|---|---|
| parse / apply / 禁 https / 64KiB | 1 |
| `isInfographicRelPath` | 1 |
| `renderSvg` 闭集 + 深色描边 | 1 |
| get / patch / 建档 / 不 mkdir | 2 |
| yml、host 预览 svg、省略插件仍出图 | 3 |
| FilePane `<img>`、不改 Knowledge | 4 |
| host 不出现 create*Tool | 3 |
| A2UI Infographic / 海报 / DocForge 其余工具 | 非目标 |
