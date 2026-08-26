# FlintLoom 工作区文件树磁盘同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Host 监听当前工作区磁盘，桌面 FilePane 用 `GET /v1/files/sync` 长轮询增量刷新已展开目录；资源管理器拷入或 Agent 写出的可见文件约一秒内出现在树里，无需点 ↻。

**Architecture:** `createFileWatch` 对 `workspaceRootRef.current` 做 `fs.watch({ recursive: true })`，300ms 去抖后 `generation++` 并唤醒等待者。`GET /v1/files/sync?generation=N` 对齐则挂起最多 20s，落后/超前立刻 catch-up。FilePane 循环请求，只 `reloadDir` 受影响且已展开的目录。不引入 SSE、chokidar，不改 `runTurn`、不改 Range 代理。

**Tech Stack:** Node `fs.watch`、现有 Host `http.createServer`、React 18 `useEffect` + `AbortController`、Vitest。不新增 npm 依赖。

## Global Constraints

- 口号与产品名：FlintLoom，A real agent. / 真正的 Agent。
- 包名前缀：`@flintloom/*`。只绑定 `127.0.0.1`。
- `hostToken` 不得进入页面。隐藏路径用 `@flintloom/tools` 的 `isHiddenRelPath`。
- 不 import、不 submodule、不拷贝 dataagent-v3 或 deepseek-harness。
- 不改 `runTurn`。不引入 SSE / EventSource / WebSocket / `chokidar`。
- 根路径 JSON 与请求用 `"."`。相对路径用 `/`，不要 `""`。
- 不自动展开折叠目录，不自动选中新文件。↻ 与右键刷新保留。
- 测试不依赖真实 API key。超时默认 **20s**；`createFileWatch` 的 `waitTimeoutMs` 可注入，避免 HTTP 用例真等 20s。
- Windows：指定文件 `git add`；不要 `git add -A`。不要提交 `check_libs.py`、`三国PPT设计方案.md`、无关 CSS。PowerShell 用 `git commit -m @"` / `"@`。
- Spec：`docs/superpowers/specs/2026-08-27-flintloom-workspace-file-sync-design.md`

## File map

```text
apps/host/src/fileWatch.ts              # 新建：watch / debounce / generation / wait / setRoot
apps/host/tests/fileWatch.test.ts       # 新建：纯模块测试（含短超时）
apps/host/src/server.ts                 # GET /v1/files/sync；startHost 生命周期
apps/host/tests/files.test.ts           # HTTP：写入唤醒、401、落后 catch-up、非法 generation
apps/desktop/src/files.ts               # fetchFilesSync
apps/desktop/src/FilePane.tsx           # 挂载循环；按 payload 增量 reload
apps/desktop/tests/App.test.tsx         # installFetch 默认挂起 sync；树出现新文件
```

不要改 `apps/desktop/src/proxy.ts`、`vite.config.ts`、Range 头、`runTurn`。

## 实现备忘（规格已批准，此处写死）

- `filename` 为 `null`/`""` → 脏 `dirs: ["."]`，`files: []`。
- 叶子路径只进 `files`，不要进 `dirs`（否则 `GET /v1/files?path=notes.md` 会 400）。`dirs` 只含 `"."` 与祖先目录。
- `waitTimeoutMs` 默认 `20_000`，`debounceMs` 默认 `300`。
- 桌面测试里 `/v1/files/sync` **默认挂到 abort**，禁止立刻返回空包（否则 FilePane 空转打爆测试）。
- 切工作区：`reloadRuntime` 里 `fileWatch.setRoot(workspaceRootRef.current)`；相同根不重置 `generation`。`close()` 关掉 watcher。
- FilePane 用 ref 读 `expanded` / `selectedFile`，sync 循环放在 `useEffect([])`，卸载 `AbortController.abort()`。
- 网络失败等 1s 再请求（可 abort）；超时空包立刻再挂。

---

### Task 1: `createFileWatch`

**Files:**
- Create: `apps/host/src/fileWatch.ts`
- Create: `apps/host/tests/fileWatch.test.ts`

**Interfaces:**
- Consumes: `node:fs` `watch` / `FSWatcher`，`@flintloom/tools` `isHiddenRelPath`
- Produces:

```ts
export type FileSyncPayload = {
  generation: number;
  dirs: string[];
  files: string[];
};

export type FileWatch = {
  generation(): number;
  wait(n: number, signal: AbortSignal): Promise<FileSyncPayload>;
  setRoot(root: string): void;
  close(): void;
};

export function createFileWatch(opts: {
  root: string;
  debounceMs?: number;
  waitTimeoutMs?: number;
}): FileWatch;
```

`wait(n, signal)`：

- `n !== generation()` → 立刻 `{ generation: current, dirs: ["."], files: [] }`
- 否则登记 waiter；下列任一发生则结束：可见变化（debounce 后 bump）、`waitTimeoutMs`、`signal` abort
- 超时：`{ generation: current, dirs: [], files: [] }`（generation 不变）
- abort：reject `AbortError`（`DOMException` 或 `Error` 且 `name === "AbortError"`），不要当一次成功超时

去抖 bump：合并窗口内路径，`generation += 1`，把这一代 `dirs`/`files`（去重，根为 `"."`）发给所有 waiter，再清空脏集。无 waiter 也 bump 并清空脏集。

忽略：`isHiddenRelPath(rel)`；`basename` 以 `~$` 开头。忽略不 bump。

`setRoot(root)`：若与当前根相同（`path.resolve` 后）则 no-op。否则关掉旧 watcher、`generation = 0`、清空脏集、abort 现有 waiter、对新根再 `watch`。watch 抛错或 `error` 事件：不 throw 出 `createFileWatch`/`setRoot`；之后 `wait` 只能超时。

相对路径：把 `\` 换成 `/`，去掉首尾 `/`。空路径只脏 `"."`。

- [ ] **Step 1: Write failing unit tests**

`apps/host/tests/fileWatch.test.ts`：

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFileWatch } from "../src/fileWatch.ts";

function tmpWorkspace(): string {
  return mkdtempSync(join(tmpdir(), "flintloom-watch-"));
}

async function waitFor(
  pred: () => boolean,
  timeoutMs = 3000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("timed out waiting for watch");
}

describe("createFileWatch", () => {
  const watches: Array<ReturnType<typeof createFileWatch>> = [];

  afterEach(() => {
    for (const w of watches) w.close();
    watches.length = 0;
  });

  function open(root: string, extra?: { debounceMs?: number; waitTimeoutMs?: number }) {
    const w = createFileWatch({
      root,
      debounceMs: extra?.debounceMs ?? 50,
      waitTimeoutMs: extra?.waitTimeoutMs ?? 200,
    });
    watches.push(w);
    return w;
  }

  it("bumps generation and records dirs/files after a visible file is written", async () => {
    const root = tmpWorkspace();
    const watch = open(root);
    expect(watch.generation()).toBe(0);
    const pending = watch.wait(0, new AbortController().signal);
    writeFileSync(join(root, "notes.md"), "hi\n");
    const payload = await pending;
    expect(payload.generation).toBe(1);
    expect(payload.dirs).toContain(".");
    expect(payload.files).toContain("notes.md");
    expect(payload.dirs).not.toContain("notes.md");
  });

  it("includes ancestor dirs for a nested file", async () => {
    const root = tmpWorkspace();
    mkdirSync(join(root, "md"));
    const watch = open(root);
    const pending = watch.wait(0, new AbortController().signal);
    writeFileSync(join(root, "md", "notes.md"), "hi\n");
    const payload = await pending;
    expect(payload.dirs).toEqual(expect.arrayContaining([".", "md"]));
    expect(payload.files).toContain("md/notes.md");
  });

  it("does not bump for .env or Office lock files", async () => {
    const root = tmpWorkspace();
    const watch = open(root, { waitTimeoutMs: 250 });
    const pending = watch.wait(0, new AbortController().signal);
    writeFileSync(join(root, ".env"), "sk-secret\n");
    writeFileSync(join(root, "~$foo.docx"), "lock\n");
    const payload = await pending;
    expect(payload.generation).toBe(0);
    expect(payload.dirs).toEqual([]);
    expect(payload.files).toEqual([]);
  });

  it("returns catch-up immediately when n !== current", async () => {
    const root = tmpWorkspace();
    const watch = open(root);
    writeFileSync(join(root, "a.md"), "a\n");
    await waitFor(() => watch.generation() >= 1);
    const t0 = Date.now();
    const payload = await watch.wait(0, new AbortController().signal);
    expect(Date.now() - t0).toBeLessThan(100);
    expect(payload.generation).toBe(watch.generation());
    expect(payload.dirs).toEqual(["."]);
    expect(payload.files).toEqual([]);
  });

  it("times out with empty dirs/files and the same generation", async () => {
    const root = tmpWorkspace();
    const watch = open(root, { waitTimeoutMs: 80 });
    const t0 = Date.now();
    const payload = await watch.wait(0, new AbortController().signal);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(70);
    expect(payload).toEqual({ generation: 0, dirs: [], files: [] });
  });

  it("rejects wait when the signal aborts", async () => {
    const root = tmpWorkspace();
    const watch = open(root, { waitTimeoutMs: 5_000 });
    const ac = new AbortController();
    const pending = watch.wait(0, ac.signal);
    ac.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("setRoot resets generation when the path changes", async () => {
    const a = tmpWorkspace();
    const b = tmpWorkspace();
    const watch = open(a);
    writeFileSync(join(a, "a.md"), "a\n");
    await waitFor(() => watch.generation() >= 1);
    watch.setRoot(b);
    expect(watch.generation()).toBe(0);
    const pending = watch.wait(0, new AbortController().signal);
    writeFileSync(join(b, "b.md"), "b\n");
    const payload = await pending;
    expect(payload.files).toContain("b.md");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run apps/host/tests/fileWatch.test.ts`

Expected: FAIL（模块不存在）。

- [ ] **Step 3: Implement `fileWatch.ts`**

```ts
import { watch, type FSWatcher } from "node:fs";
import { basename, resolve } from "node:path";
import { isHiddenRelPath } from "@flintloom/tools";

export type FileSyncPayload = {
  generation: number;
  dirs: string[];
  files: string[];
};

export type FileWatch = {
  generation(): number;
  wait(n: number, signal: AbortSignal): Promise<FileSyncPayload>;
  setRoot(root: string): void;
  close(): void;
};

type Waiter = {
  resolve: (payload: FileSyncPayload) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  onAbort: () => void;
  signal: AbortSignal;
};

function posixRel(filename: string): string {
  return filename.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
}

function isOfficeLock(rel: string): boolean {
  return basename(rel).startsWith("~$");
}

function dirsForFile(rel: string): string[] {
  const dirs = new Set<string>(["."]);
  const parts = rel.split("/").filter(Boolean);
  let acc = "";
  for (let i = 0; i < parts.length - 1; i++) {
    acc = acc ? `${acc}/${parts[i]}` : parts[i]!;
    dirs.add(acc);
  }
  return [...dirs];
}

function abortError(): Error {
  const err = new Error("Aborted");
  err.name = "AbortError";
  return err;
}

export function createFileWatch(opts: {
  root: string;
  debounceMs?: number;
  waitTimeoutMs?: number;
}): FileWatch {
  const debounceMs = opts.debounceMs ?? 300;
  const waitTimeoutMs = opts.waitTimeoutMs ?? 20_000;
  let root = resolve(opts.root);
  let current = 0;
  let watcher: FSWatcher | undefined;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  const dirtyDirs = new Set<string>();
  const dirtyFiles = new Set<string>();
  const waiters = new Set<Waiter>();

  function stopWatcher(): void {
    watcher?.removeAllListeners();
    try {
      watcher?.close();
    } catch {
      // ignore
    }
    watcher = undefined;
  }

  function rejectWaiters(): void {
    for (const waiter of [...waiters]) {
      waiter.signal.removeEventListener("abort", waiter.onAbort);
      clearTimeout(waiter.timer);
      waiter.reject(abortError());
    }
    waiters.clear();
  }

  function flush(): void {
    debounceTimer = undefined;
    if (dirtyDirs.size === 0 && dirtyFiles.size === 0) return;
    current += 1;
    const payload: FileSyncPayload = {
      generation: current,
      dirs: [...dirtyDirs],
      files: [...dirtyFiles],
    };
    dirtyDirs.clear();
    dirtyFiles.clear();
    for (const waiter of [...waiters]) {
      waiter.signal.removeEventListener("abort", waiter.onAbort);
      clearTimeout(waiter.timer);
      waiter.resolve(payload);
    }
    waiters.clear();
  }

  function noteChange(relRaw: string | null): void {
    if (relRaw === null || relRaw.length === 0) {
      dirtyDirs.add(".");
    } else {
      const rel = posixRel(relRaw);
      if (rel.length === 0) {
        dirtyDirs.add(".");
      } else if (isHiddenRelPath(rel) || isOfficeLock(rel)) {
        return;
      } else {
        for (const dir of dirsForFile(rel)) dirtyDirs.add(dir);
        dirtyFiles.add(rel);
      }
    }
    if (debounceTimer !== undefined) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flush, debounceMs);
  }

  function startWatcher(): void {
    stopWatcher();
    try {
      watcher = watch(root, { recursive: true }, (_event, filename) => {
        noteChange(filename);
      });
      watcher.on("error", () => {
        stopWatcher();
      });
    } catch {
      watcher = undefined;
    }
  }

  startWatcher();

  return {
    generation() {
      return current;
    },
    wait(n, signal) {
      if (n !== current) {
        return Promise.resolve({
          generation: current,
          dirs: ["."],
          files: [],
        });
      }
      if (signal.aborted) return Promise.reject(abortError());
      return new Promise<FileSyncPayload>((resolveP, rejectP) => {
        const waiter: Waiter = {
          resolve: resolveP,
          reject: rejectP,
          signal,
          timer: setTimeout(() => {
            waiters.delete(waiter);
            signal.removeEventListener("abort", waiter.onAbort);
            resolveP({ generation: current, dirs: [], files: [] });
          }, waitTimeoutMs),
          onAbort: () => {
            waiters.delete(waiter);
            clearTimeout(waiter.timer);
            rejectP(abortError());
          },
        };
        signal.addEventListener("abort", waiter.onAbort, { once: true });
        waiters.add(waiter);
      });
    },
    setRoot(nextRoot) {
      const resolved = resolve(nextRoot);
      if (resolved === root) return;
      if (debounceTimer !== undefined) clearTimeout(debounceTimer);
      debounceTimer = undefined;
      dirtyDirs.clear();
      dirtyFiles.clear();
      current = 0;
      rejectWaiters();
      root = resolved;
      startWatcher();
    },
    close() {
      if (debounceTimer !== undefined) clearTimeout(debounceTimer);
      debounceTimer = undefined;
      dirtyDirs.clear();
      dirtyFiles.clear();
      rejectWaiters();
      stopWatcher();
    },
  };
}
```

`wait` 里 `waiter` 自引用 `onAbort`：先声明对象再赋 `onAbort`，或把 `onAbort` 写成闭包里的 `const onAbort = () => { ... }` 再放进对象。不要留下 TDZ。

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run apps/host/tests/fileWatch.test.ts`

Expected: PASS。若 Windows 偶发漏事件，把 `debounceMs` 保持 50，并把 `waitFor` 超时留在 3000ms；不要改成轮询 `readdir` 冒充 watch。

- [ ] **Step 5: Commit**

```powershell
git add apps/host/src/fileWatch.ts apps/host/tests/fileWatch.test.ts
git commit -m @"
feat(host): 工作区 fs.watch 与 generation 长轮询内核

"@
```

---

### Task 2: `GET /v1/files/sync` 与 Host 生命周期

**Files:**
- Modify: `apps/host/src/server.ts`
- Modify: `apps/host/tests/files.test.ts`

**Interfaces:**
- Consumes: Task 1 `createFileWatch` / `FileWatch` / `FileSyncPayload`
- Produces: `GET /v1/files/sync?generation=<n>` JSON；`startHost` 启动 watch，`reloadRuntime` 调 `setRoot`，`close` 调 `watch.close()`

路由必须写在 `pathname === "/v1/files"` **之前**（本仓库是全等匹配，仍按规格放前面，避免以后改成前缀匹配时被吃掉）。

鉴权：已有 `/v1/` Bearer 检查在前面，缺 token 自然 401，不要给 sync 单独开匿名。

`generation`：缺省、空、非 `/^[0-9]+$/` → `send(res, 400)`。合法则 `Number(raw)` 交给 `fileWatch.wait`。

取消：`req`/`res` 的 `close` 时 `AbortController.abort()`。`wait` reject 后若 `res.headersSent` 或 `destroyed` 或 `writableEnded` 则不要 `writeHead`。成功则 `sendJson(res, 200, payload)`。

`handleRequest` 的 opts 增加 `fileWatch: FileWatch`。`startHost`：

```ts
const fileWatch = createFileWatch({ root: workspaceRootRef.current });
```

`reloadRuntime` 末尾：

```ts
fileWatch.setRoot(workspaceRootRef.current);
```

`close` 在 `server.closeAllConnections()` 之前：

```ts
fileWatch.close();
```

生产用默认 `waitTimeoutMs: 20_000`、`debounceMs: 300`，不要在 `startHost` 改短。

- [ ] **Step 1: Write failing HTTP tests**

在 `apps/host/tests/files.test.ts` 追加 `describe("GET /v1/files/sync", ...)`，复用 `afterEach` close、`loadOrCreateToken`、`startHost({ workspaceRoot, homeDir, port: 0 })`、`Authorization: Bearer`。

```ts
describe("GET /v1/files/sync", () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    if (close) {
      await close();
      close = undefined;
    }
  });

  async function startSyncHost() {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-sync-ws-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-sync-home-"));
    writeAssembly(workspaceRoot);
    writeFileSync(join(workspaceRoot, "README.md"), "# Hello\n");
    const host = await startHost({ workspaceRoot, homeDir, port: 0 });
    close = host.close;
    return {
      url: host.url,
      token: loadOrCreateToken(homeDir),
      workspaceRoot,
    };
  }

  function authHeaders(token: string): HeadersInit {
    return { Authorization: `Bearer ${token}` };
  }

  it("wakes when a visible file is written while waiting", async () => {
    const { url, token, workspaceRoot } = await startSyncHost();
    const pending = fetch(`${url}/v1/files/sync?generation=0`, {
      headers: authHeaders(token),
    });
    writeFileSync(join(workspaceRoot, "notes.md"), "from-disk\n");
    const res = await pending;
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      generation: number;
      dirs: string[];
      files: string[];
    };
    expect(body.generation).toBeGreaterThan(0);
    expect(body.dirs).toContain(".");
    expect(body.files).toContain("notes.md");
  });

  it("returns catch-up immediately when generation is stale", async () => {
    const { url, token, workspaceRoot } = await startSyncHost();
    writeFileSync(join(workspaceRoot, "a.md"), "a\n");
    const first = await fetch(`${url}/v1/files/sync?generation=0`, {
      headers: authHeaders(token),
    });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { generation: number };
    expect(firstBody.generation).toBeGreaterThan(0);
    const t0 = Date.now();
    const second = await fetch(`${url}/v1/files/sync?generation=0`, {
      headers: authHeaders(token),
    });
    expect(second.status).toBe(200);
    expect(Date.now() - t0).toBeLessThan(500);
    const body = (await second.json()) as {
      generation: number;
      dirs: string[];
      files: string[];
    };
    expect(body.generation).toBe(firstBody.generation);
    expect(body.dirs).toEqual(["."]);
    expect(body.files).toEqual([]);
  });

  it("rejects missing bearer with 401", async () => {
    const { url } = await startSyncHost();
    const res = await fetch(`${url}/v1/files/sync?generation=0`);
    expect(res.status).toBe(401);
  });

  it("rejects missing or invalid generation with 400", async () => {
    const { url, token } = await startSyncHost();
    const headers = authHeaders(token);
    const missing = await fetch(`${url}/v1/files/sync`, { headers });
    expect(missing.status).toBe(400);
    const bad = await fetch(`${url}/v1/files/sync?generation=foo`, { headers });
    expect(bad.status).toBe(400);
    const neg = await fetch(`${url}/v1/files/sync?generation=-1`, { headers });
    expect(neg.status).toBe(400);
  });
});
```

不要在 HTTP 层写「空等 20s」用例（Task 1 已覆盖超时语义）。隐藏文件忽略由 Task 1 覆盖。

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run apps/host/tests/files.test.ts`

Expected: FAIL（`/v1/files/sync` 404）。

- [ ] **Step 3: Wire the route and lifecycle**

1. `server.ts` 顶部增加：`import { createFileWatch, type FileWatch } from "./fileWatch.ts";`
2. `handleRequest` opts 增加 `fileWatch: FileWatch`。
3. 在 `GET /v1/files` 之前插入：

```ts
  if (req.method === "GET" && pathname === "/v1/files/sync") {
    const raw = url.searchParams.get("generation");
    if (raw === null || raw === "" || !/^[0-9]+$/.test(raw)) {
      send(res, 400);
      return;
    }
    const n = Number(raw);
    const ac = new AbortController();
    const onClose = () => {
      ac.abort();
    };
    req.on("close", onClose);
    res.on("close", onClose);
    try {
      const payload = await opts.fileWatch.wait(n, ac.signal);
      if (!res.destroyed && !res.writableEnded && !res.headersSent) {
        sendJson(res, 200, payload);
      }
    } catch {
      // client gone or workspace switched
    } finally {
      req.off("close", onClose);
      res.off("close", onClose);
    }
    return;
  }
```

4. `startHost` 创建 `fileWatch`，传入 `handleRequest`；`reloadRuntime` 末尾 `fileWatch.setRoot(workspaceRootRef.current)`；`close` 里先 `fileWatch.close()`。

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run apps/host/tests/files.test.ts apps/host/tests/fileWatch.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add apps/host/src/server.ts apps/host/tests/files.test.ts
git commit -m @"
feat(host): 提供 GET /v1/files/sync 长轮询

"@
```

---

### Task 3: FilePane 循环长轮询并刷新树

**Files:**
- Modify: `apps/desktop/src/files.ts`
- Modify: `apps/desktop/src/FilePane.tsx`
- Modify: `apps/desktop/tests/App.test.tsx`

**Interfaces:**
- Consumes: Host `{ generation, dirs, files }`；现有 `fetchFiles` / `reloadDir` / `refreshTree` / `startPreview`
- Produces:

```ts
export type FileSync = {
  generation: number;
  dirs: string[];
  files: string[];
};

export async function fetchFilesSync(
  generation: number,
  signal?: AbortSignal,
): Promise<FileSync>;
```

`fetchFilesSync`：`GET /v1/files/sync?generation=${generation}`，`!res.ok` throw。

**`installFetch` 必须在 `url.includes("/v1/files")` 之前处理 sync**，否则会被列表 mock 吞掉。默认行为：

```ts
function hangUntilAbort(signal?: AbortSignal): Promise<Response> {
  return new Promise((_resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    signal?.addEventListener(
      "abort",
      () => {
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}
```

`installFetch` 增加可选 `filesSync?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>`。若提供则调用它；否则 `hangUntilAbort(init?.signal)`。

FilePane：

- `expandedRef` / `selectedFileRef` 每轮渲染写回。
- 另开 `useEffect(() => { ... }, [])`（不要和初次 `fetchFiles(".")` 绑在一起）。
- 循环：`generation` 从 `0` 起；`const sync = await fetchFilesSync(generation, ac.signal)`；判定 catch-up：`generation !== sync.generation && sync.files.length === 0 && sync.dirs.length === 1 && sync.dirs[0] === "."`；然后 `generation = sync.generation`。
- catch-up：调用最新的 `refreshTree()`（经 `refreshTreeRef.current`，这样预览用当前 `selectedFile`）。
- 超时空包（`dirs`/`files` 都空）：立刻下一轮。
- 否则：对 `sync.dirs` 里 `dir === "."` 或 `expandedRef.current.has(dir)` 的项 `reloadDir`；若 `selectedFileRef.current` 在 `sync.files` 里则 `startPreview`。
- `AbortError` / `signal.aborted`：退出循环。其它错误：`await` 1s（同样尊重 abort）再试。
- 知识库 tab 不要停循环。
- 卸载 abort。不要自动 expand、不要改 `selectedFile` 到新文件。

1s 等待：

```ts
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}
```

- [ ] **Step 1: Write the failing desktop test and hang default**

先改 `installFetch`：加上 `filesSync` 参数与 `/v1/files/sync` 分支（默认 hang）。现有用例不应开始打爆 CPU；若漏掉 hang，后续测试会卡住，先跑一个现有树测试确认。

然后新增：

```ts
  it("adds a workspace file when file sync reports it", async () => {
    let entries: Array<{ name: string; type: "file" | "dir" }> = [
      { name: "README.md", type: "file" },
    ];
    let resolveSync: ((res: Response) => void) | undefined;
    installFetch({
      listRootEntries: () => entries,
      filesSync: () =>
        new Promise<Response>((resolve) => {
          resolveSync = resolve;
        }),
    });
    await mountApp();
    await waitForText("README.md");
    expect(findFileTreeButton("notes.md")).toBeUndefined();
    const urls = vi.mocked(fetch).mock.calls.map(([input]) => requestUrl(input));
    expect(urls.some((u) => u.includes("/v1/files/sync?generation=0"))).toBe(
      true,
    );

    entries = [
      { name: "README.md", type: "file" },
      { name: "notes.md", type: "file" },
    ];
    await act(async () => {
      resolveSync?.(
        new Response(
          JSON.stringify({
            generation: 1,
            dirs: ["."],
            files: ["notes.md"],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    });
    await waitForText("notes.md");
  });
```

`filesSync` 只 resolve 一次即可；FilePane 下一轮会再调 `filesSync`，让它再次 hang（第二次 Promise 不 resolve）。写成：

```ts
let delivered = false;
filesSync: () => {
  if (delivered) return hangUntilAbort();
  return new Promise<Response>((resolve) => {
    resolveSync = (res) => {
      delivered = true;
      resolve(res);
    };
  });
};
```

把 `hangUntilAbort` 放到 `App.test.tsx` 里 `installFetch` 附近，测试与默认 mock 共用。

- [ ] **Step 2: Run the new test to verify it fails**

Run: `pnpm exec vitest run apps/desktop/tests/App.test.tsx -t "adds a workspace file when file sync reports it"`

Expected: FAIL（没有 `/v1/files/sync` 请求，或树里没有 `notes.md`）。

先确认现有 `refreshes workspace files from the header button` 在 hang 默认下仍 PASS：

Run: `pnpm exec vitest run apps/desktop/tests/App.test.tsx -t "refreshes workspace files from the header button"`

Expected: PASS。

- [ ] **Step 3: Implement client + FilePane loop**

`files.ts` 增加 `FileSync` 与 `fetchFilesSync`（紧挨 `fetchFiles`）。

`FilePane.tsx`：

```ts
const expandedRef = useRef(expanded);
expandedRef.current = expanded;
const selectedFileRef = useRef(selectedFile);
selectedFileRef.current = selectedFile;
const refreshTreeRef = useRef(refreshTree);
refreshTreeRef.current = refreshTree;
const reloadDirRef = useRef(reloadDir);
reloadDirRef.current = reloadDir;
const startPreviewRef = useRef(startPreview);
startPreviewRef.current = startPreview;

useEffect(() => {
  const ac = new AbortController();
  let generation = 0;

  async function loop() {
    while (!ac.signal.aborted) {
      try {
        const sync = await fetchFilesSync(generation, ac.signal);
        if (ac.signal.aborted) return;
        const isCatchUp =
          generation !== sync.generation &&
          sync.files.length === 0 &&
          sync.dirs.length === 1 &&
          sync.dirs[0] === ".";
        generation = sync.generation;
        if (isCatchUp) {
          await refreshTreeRef.current();
          continue;
        }
        if (sync.dirs.length === 0 && sync.files.length === 0) {
          continue;
        }
        const expandedNow = expandedRef.current;
        for (const dir of sync.dirs) {
          if (dir === ROOT_TREE_PATH || expandedNow.has(dir)) {
            try {
              await reloadDirRef.current(dir);
            } catch {
              // listing 失败时留给 ↻；根失败由 reloadDir 的调用方不设 treeError 也可
            }
          }
        }
        const selected = selectedFileRef.current;
        if (selected && sync.files.includes(selected)) {
          await startPreviewRef.current(selected);
        }
      } catch (err) {
        if (ac.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (err instanceof Error && err.name === "AbortError") return;
        try {
          await delay(1000, ac.signal);
        } catch {
          return;
        }
      }
    }
  }

  void loop();
  return () => {
    ac.abort();
  };
}, []);
```

把这段 `useEffect` 放在 `refreshTree` / `reloadDir` / `startPreview` **函数声明之后**，这样首帧就能写上 ref。这三个函数每次渲染都是新引用，**不要**放进 effect 依赖数组，否则会重置 `generation`、打断长轮询。只用 ref。

根 `reloadDir` 失败时应 `setTreeError(true)`：在循环的 catch 里对 `ROOT_TREE_PATH` 调用失败时：

```ts
            try {
              await reloadDirRef.current(dir);
              if (dir === ROOT_TREE_PATH) setTreeError(false);
            } catch {
              if (dir === ROOT_TREE_PATH) setTreeError(true);
              else {
                setDirErrors((prev) => new Set(prev).add(dir));
              }
            }
```

- [ ] **Step 4: Run desktop tests**

Run: `pnpm exec vitest run apps/desktop/tests/App.test.tsx -t "adds a workspace file when file sync reports it"`

Expected: PASS。

再跑：`pnpm exec vitest run apps/desktop/tests/App.test.tsx -t "refreshes workspace files from the header button"`

Expected: PASS。

最后：`pnpm exec vitest run apps/host/tests/fileWatch.test.ts apps/host/tests/files.test.ts apps/desktop/tests/App.test.tsx`

Expected：本片相关用例 PASS。若文件里另有预先存在的失败（知识库 Import、`.selected`），不要为了绿而改无关断言；只保证本片新增/触及的用例通过。

- [ ] **Step 5: 手动验收（实现者本机）**

`pnpm desktop:app:restart`（或当前正在跑的 5173）。在 demo 工作区根用资源管理器拷入一个 `from-explorer.md`（不要用文件树菜单）。不超过约一秒，树中出现该文件，无需点 ↻。点 ↻ 仍可用。不要自动打开该文件。

- [ ] **Step 6: Commit**

```powershell
git add apps/desktop/src/files.ts apps/desktop/src/FilePane.tsx apps/desktop/tests/App.test.tsx
git commit -m @"
feat(desktop): 文件树长轮询同步磁盘变化

"@
```

不要把 `check_libs.py`、`三国PPT设计方案.md`、未要求的 `app.css` 塞进这次提交。
