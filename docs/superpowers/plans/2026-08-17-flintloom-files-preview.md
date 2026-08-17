# FlintLoom 文件树与预览 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pnpm desktop` 后工作台右侧能列出工作区文件、预览文档/源码，单击把相对路径插入输入框且不自动发送。

**Architecture:** Host 提供 `GET /v1/files` 与 `GET /v1/files/preview`（先匹配 preview）。路径 `resolveInside`。文档走 `@flintloom/docforge` 的 `detectType`/`parse`；源码与无扩展名文本按 UTF-8 读取。页面经现有 5173 代理，不改 token 语义。

**Tech Stack:** 现有 Node http host、React 18、Vitest、jsdom。不引入 markdown 渲染库、Express、`http-proxy`。

## Global Constraints

- 口号与产品名：FlintLoom，A real agent. / 真正的 Agent。
- 包名前缀：`@flintloom/*`。
- 只绑定 `127.0.0.1`；host `7331`；Vite `5173`。
- `hostToken` 与模型 key 不得进入页面。`.env*`（除 `.env.example`）不得预览。
- 不 import、不 submodule、不拷贝 dataagent-v3 或 deepseek-harness。
- 不改 `runTurn`。不做上传、知识库、Electron、A2UI、信息图渲染。
- 根路径 JSON 与请求用 `"."`。相对路径用 `/`。
- 隐藏判断用 basename / 路径段，禁止只靠 `path.extname(".env")`。
- Windows 提交用 Git Bash；不要 `git add -A`。

Spec：`docs/superpowers/specs/2026-08-17-flintloom-files-preview-design.md`

## File map

```text
apps/host/src/files.ts
apps/host/src/server.ts
apps/host/tests/files.test.ts
apps/desktop/src/files.ts
apps/desktop/src/FilePane.tsx
apps/desktop/src/App.tsx
apps/desktop/src/app.css
apps/desktop/tests/App.test.tsx
```

---

### Task 1: Host list + preview

**Files:**
- Create: `apps/host/src/files.ts`
- Create: `apps/host/tests/files.test.ts`
- Modify: `apps/host/src/server.ts`（先匹配 preview 再匹配 files）

**Interfaces:**
- Consumes: `resolveInside`、`WorkspaceEscapeError`、`detectType`、`parse`、`readdir`/`stat`/`readFile`
- Produces:

```ts
export type FileEntry = { name: string; type: "file" | "dir" };
export type FileList = { path: string; entries: FileEntry[] };
export type FilePreview = {
  path: string;
  kind: "markdown" | "text" | "failed";
  text: string;
};

export function isHiddenRelPath(relPath: string): boolean;
export function normalizeRelPath(relPath: string | null): string | undefined;
export async function listWorkspaceFiles(
  workspaceRoot: string,
  relPath: string,
): Promise<"not_found" | "not_directory" | "hidden" | FileList>;
export async function previewWorkspaceFile(
  workspaceRoot: string,
  relPath: string,
): Promise<"not_found" | FilePreview>;
```

`normalizeRelPath`：`null`/空 → list 用 `"."`，preview 用 `undefined`（表示缺 path）。剥掉首尾 `/`，把 `\` 换成 `/`，拒绝结果为 `""` 以外再处理。

`isHiddenRelPath`：按 `/` 切开每一段 basename：
- 等于 `.git` | `node_modules` | `dist` | `credentials`
- 或 `/^\.env(?!\.example$)/.test(name)`
- 或 `extname(name) === ".env"`（`secret.env`）

`listWorkspaceFiles`：若 hidden → `"hidden"`（路由映射 404）。`resolveInside` 抛越界则让调用方 catch。stat 不存在 → `"not_found"`；是文件 → `"not_directory"`；readdir 后丢掉 hidden 名，排序 `localeCompare("en")`。

`previewWorkspaceFile`：hidden → `{ kind: "failed", text: "failed: hidden" }`（仍 200）。目录 → `failed: not a file`。然后 spec §4 步骤 6–8。文本截断与 fs 相同：`200000` + `\n\n[truncated: output exceeded 200000 characters]`。NUL：`bytes.includes(0)`。

- [ ] **Step 1: Write failing host tests**

`apps/host/tests/files.test.ts`：用 `startHost` + Bearer，在临时工作区写入：

```
README.md          # Hello
.env               sk-secret
.env.example       example
.env.production    prod
secret.env         sk
Makefile           hello-make
src/a.ts           export const n = 1
node_modules/pkg/x.js  hide-me
```

用 `loadOrCreateToken`。断言：

1. `GET /v1/files` 与 `GET /v1/files?path=.` 的 `entries` name 含 `README.md`、`src`、`.env.example`、`Makefile`，不含 `node_modules`、`.env`、`.env.production`、`secret.env`；返回 `path` 为 `"."`
2. `GET /v1/files/preview?path=README.md` → 200，`kind === "markdown"`，`text` 含 `Hello`
3. `preview?path=src/a.ts` 与 `Makefile` → `kind === "text"`，分别含 `export` 与 `hello-make`
4. `preview?path=.env`、`.env.production`、`secret.env` → 200，`text === "failed: hidden"`
5. `preview?path=.env.example` → 200，`kind` 不是 `failed` 或 text 不是 `failed: hidden`（内容含 `example`）
6. `GET /v1/files?path=node_modules` → 404
7. `GET /v1/files?path=README.md` → 400，body 含 `failed: not a directory`
8. `GET /v1/files/preview` 无 path → 400
9. `GET /v1/files?path=../x` → 400，body 含 `Path escapes workspace`
10. 无 Bearer 的 `/v1/files` → 401

路由测试必须打真实 HTTP（与现有 `server.test.ts` 一样），不要只测纯函数却不接线。纯函数可在同文件另测 `isHiddenRelPath(".env") === true` 且 `isHiddenRelPath(".env.example") === false`。

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run apps/host/tests/files.test.ts`

Expected: FAIL（404 或模块不存在）。

- [ ] **Step 3: Implement `files.ts` and wire routes**

`apps/host/src/files.ts` 实现上面的函数。文本白名单与 spec 一致。DocForge 类型：`["md","html","pdf","docx","pptx","xlsx"]`。

`server.ts` 在 session 路由附近加入（**preview 在 files 之前**）：

```ts
if (req.method === "GET" && pathname === "/v1/files/preview") {
  const rel = normalizeRelPath(url.searchParams.get("path"));
  if (rel === undefined) {
    send(res, 400);
    return;
  }
  try {
    const result = await previewWorkspaceFile(opts.workspaceRoot, rel);
    if (result === "not_found") {
      send(res, 404);
      return;
    }
    sendJson(res, 200, result);
  } catch (err) {
    if (err instanceof WorkspaceEscapeError) {
      send(res, 400, err.message);
      return;
    }
    throw err;
  }
  return;
}

if (req.method === "GET" && pathname === "/v1/files") {
  const rel = normalizeRelPath(url.searchParams.get("path")) ?? ".";
  try {
    const result = await listWorkspaceFiles(opts.workspaceRoot, rel);
    if (result === "hidden" || result === "not_found") {
      send(res, 404);
      return;
    }
    if (result === "not_directory") {
      send(res, 400, "failed: not a directory");
      return;
    }
    sendJson(res, 200, result);
  } catch (err) {
    if (err instanceof WorkspaceEscapeError) {
      send(res, 400, err.message);
      return;
    }
    throw err;
  }
  return;
}
```

`handleRequest` 里现有 `new URL(req.url ?? "/", "http://127.0.0.1")` 只取了 `pathname`。改成先保存 `const url = new URL(...)` 再用 `url.pathname` 与 `url.searchParams`。

从 `@flintloom/tools` 引入 `WorkspaceEscapeError`。host 已依赖 `@flintloom/docforge`。

- [ ] **Step 4: Run host tests**

Run: `pnpm exec vitest run apps/host/tests`

Expected: PASS（含原 server 用例）。

- [ ] **Step 5: Commit**

```bash
git add apps/host/src/files.ts apps/host/src/server.ts apps/host/tests/files.test.ts
git commit -m "feat: add host file list and preview routes"
```

---

### Task 2: 工作台右栏文件树与预览

**Files:**
- Create: `apps/desktop/src/files.ts`
- Create: `apps/desktop/src/FilePane.tsx`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/app.css`
- Modify: `apps/desktop/tests/App.test.tsx`

**Interfaces:**
- Consumes: `GET /v1/files?path=`、`GET /v1/files/preview?path=`（经页面同源 fetch）
- Produces:

```ts
export type FileEntry = { name: string; type: "file" | "dir" };
export type FileList = { path: string; entries: FileEntry[] };
export type FilePreview = {
  path: string;
  kind: "markdown" | "text" | "failed";
  text: string;
};

export function childPath(parent: string, name: string): string;
export function insertPath(input: string, filePath: string): string;
export async function fetchFiles(path: string, signal?: AbortSignal): Promise<FileList>;
export async function fetchPreview(path: string, signal?: AbortSignal): Promise<FilePreview>;
```

`childPath(".", "README.md")` → `"README.md"`。`childPath("docs", "a.md")` → `"docs/a.md"`。

`insertPath`：trim 后按空白取最后 token，已等于 `filePath` 则返回原 input；否则若 input 去掉尾空白后为空则返回 `filePath`，否则 `trimmed + " " + filePath`（保留的实现：对非空原串用「去掉尾部空白再加空格再加路径」，不要丢用户未发送的正文）。

`fetchFiles` / `fetchPreview`：`!res.ok` 或 throw → 调用方显示 `host unreachable`。404 对 list 也当 unreachable 或空树+unreachable；与 spec 一致用预览/树文案 `host unreachable`。

- [ ] **Step 1: Extend App tests (failing)**

`installFetch` **必须先匹配** `url.includes("/v1/files/preview")`，再匹配 `/v1/files`，再匹配现有 models/session/turns。默认 files：

```json
{ "path": ".", "entries": [{ "name": "README.md", "type": "file" }] }
```

默认 preview：

```json
{ "path": "README.md", "kind": "markdown", "text": "# Hello\n" }
```

新用例：`mountApp` 后 `container.textContent` 含 `README.md` 与 `Hello`。点击名为 `README.md` 的按钮/行后，`textarea.value` 为 `README.md`；再点一次仍是一次 `README.md`。

现有聊天用例必须仍通过。fetch mock 对未声明的 `/v1/files` 不要 `throw unexpected`。

- [ ] **Step 2: Run App tests to verify new case fails**

Run: `pnpm exec vitest run apps/desktop/tests/App.test.tsx`

Expected: FAIL（页面还没有文件名）。

- [ ] **Step 3: Implement FilePane and layout**

`files.ts`：上面的 fetch + `childPath` + `insertPath`。

`FilePane.tsx`：props `{ onInsertPath: (path: string) => void }`。加载根 `fetchFiles(".")`。目录：button 展开，展开后 `fetchFiles(childPath)`。文件：button 调用 preview 与 `onInsertPath`。预览 `<pre className="file-preview">`。错误文案 `host unreachable`。换文件 `AbortController`。

`App.tsx`：`.workbench-body` 横向 flex；左 `.chat-column` 放原来的 `main.log` + `footer.composer`；右 `<FilePane onInsertPath={(p) => setInput((cur) => insertPath(cur, p))} />`。顶栏仍全宽。

`app.css`：`.workbench-body { flex:1; display:flex; min-height:0; }` 左栏 `flex:1.4` 右栏 `flex:1; min-width:16rem; border-left:1px solid #2a2a2a;` 右栏内树 `flex:0.7; overflow:auto` 预览 `flex:1; overflow:auto`。

- [ ] **Step 4: Run desktop + full suite**

Run: `pnpm exec vitest run apps/desktop/tests`

Expected: PASS。

Run: `pnpm test`

Expected: 全部 PASS。再 `pnpm typecheck`，Expected: exit 0。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/files.ts apps/desktop/src/FilePane.tsx apps/desktop/src/App.tsx apps/desktop/src/app.css apps/desktop/tests/App.test.tsx
git commit -m "feat: show workspace file tree and preview in the workbench"
```

---

## Spec coverage

| Spec | Task |
|---|---|
| 路由顺序 preview 先于 files | 1 |
| 隐藏规则 / `.env` extname 陷阱 / 直拼 node_modules 404 | 1 |
| DocForge vs 文本白名单 vs 无扩展名 | 1 |
| list 打到文件 400 | 1 |
| 越界 400、缺 preview path 400 | 1 |
| 右栏布局、单击插入、去重、`<pre>` | 2 |
| App mock 先匹配 preview URL | 2 |
| 不改代理 / runTurn / 上传 / 知识库 | 全任务禁止改那些行为 |
