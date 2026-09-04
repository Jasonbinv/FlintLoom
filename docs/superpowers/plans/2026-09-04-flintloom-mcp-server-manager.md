# FlintLoom MCP 服务器管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 工作台插件页可对工作区 `mcp-servers.yml` 增删改开关；单台 MCP 失败只标红；重载 host 先起新再停旧，失败时旧运行时继续服务。

**Architecture:** kernel 解析 `enabled`、跳过禁用行、导出 MCP 状态表键与 YAML 原子写入。`@flintloom/mcp` 的 `apply` 捕获启动失败并写入状态表。host 新增 `/v1/mcp-servers*`，`reloadRuntime` 改为先 `createRuntime` 再 `stop`。桌面 `PluginsPane` 第一块改为可编辑 MCP 列表。

**Tech Stack:** 现有 kernel / mcp / host / desktop、`yaml` `parseDocument`、Vitest。夹具 `packages/mcp/fixtures/fake-mcp-server.mjs` + `process.execPath`。不引入 MCP SDK，不打网，不用 `npx`。

## Global Constraints

- Spec：`docs/superpowers/specs/2026-09-04-flintloom-plugin-capability-manager-design.md`
- `apps/host/src` 不得出现 `@flintloom/mcp`、`createMcp`、`mcp__`（连 `import type` 也不要）。工具名只从状态表透传。
- 失败文案不得含 token、env **值**、绝对 `homeDir`。
- `enabled: false` 才写进 YAML；打开则删该键。
- 新 MCP 接口 409 为 JSON `{ "error": "busy", "written": true }`。`/v1/settings/reload` 与 `/v1/plugins/install` 仍纯文本 `busy`。
- HTTP 入参校验失败 400 **不写文件**。已落盘的坏 command 开机时该行 `error`，不 500。
- Windows：指定文件 `git add`；不要 `git add -A`。PowerShell 用 `git commit -m @"` / `"@`。不要用 `&&`。
- 不要提交 `.env`、`check_libs.py`。Commit 不要 `Co-authored-by`。
- 本计划 **不做** 可选能力开关、`GET /v1/plugins/declared`、loop 提示词、知识库空态（第二期另一份计划）。

## File map

```text
packages/kernel/src/config.ts              # FlintloomPluginRow.enabled; loadConfig
packages/kernel/src/apply-config.ts        # skip enabled === false（id 仍占 seen）
packages/kernel/src/mcp-servers.ts         # McpServerRow.enabled; merge 跳过禁用; 状态键; listDeclarations
packages/kernel/src/plugin-kind.ts         # pluginKind / isPluginToggleable（第二期要用，本片先落地并测）
packages/kernel/src/yaml-atomic.ts         # 从 install-plugin 抽出 replaceYmlAtomic
packages/kernel/src/mcp-servers-write.ts   # 工作区 mcp-servers.yml 增删改 enabled
packages/kernel/src/index.ts               # 导出
packages/kernel/src/install-plugin.ts      # 改用 yaml-atomic
packages/kernel/tests/config.test.ts
packages/kernel/tests/apply-config.test.ts
packages/kernel/tests/mcp-servers.test.ts
packages/kernel/tests/plugin-kind.test.ts
packages/kernel/tests/mcp-servers-write.test.ts

packages/mcp/src/index.ts                  # apply 不抛; 写状态表
packages/mcp/tests/plugin.test.ts          # 缺 env / 坏 command 不抛

apps/host/src/server.ts                    # 原子 reloadRuntime; 挂 mcp-servers 路由
apps/host/src/mcp-servers-http.ts          # GET/POST/PUT/PATCH/DELETE/copy
apps/host/tests/server.test.ts             # 原子重载、隔离、HTTP

apps/desktop/src/api.ts                    # fetch/mutate mcp-servers
apps/desktop/src/PluginsPane.tsx           # MCP 块
apps/desktop/tests/App.test.tsx
docs/mcp-servers.md
```

---

### Task 1: `enabled` 解析、skip apply、MCP 合并跳过禁用

**Files:**
- Modify: `packages/kernel/src/config.ts`
- Modify: `packages/kernel/src/apply-config.ts`
- Modify: `packages/kernel/src/mcp-servers.ts`
- Modify: `packages/kernel/src/index.ts`（若需导出 `enabled` 类型即可）
- Test: `packages/kernel/tests/config.test.ts`
- Test: `packages/kernel/tests/apply-config.test.ts`
- Test: `packages/kernel/tests/mcp-servers.test.ts`

**Interfaces:**
- Consumes: 现有 `loadConfig` / `applyConfig` / `loadMcpServersFile` / `mergeMcpServersIntoConfig`
- Produces:

```ts
export type FlintloomPluginRow = {
  id: string;
  name: string;
  config?: Record<string, unknown>;
  enabled?: boolean; // 仅 false 时出现
};

export type McpServerRow = {
  id: string;
  command: string;
  args?: string[];
  env?: string[];
  enabled?: boolean; // 仅 false 时出现
};
```

- [ ] **Step 1: Write the failing tests**

`config.test.ts` 追加：

```ts
  it("enabled false 写入行；缺省视为开；非布尔抛 enabled", () => {
    const off = loadConfig(`
plugins:
  - id: session
    name: "@flintloom/session"
    enabled: false
`);
    expect(off.plugins[0]?.enabled).toBe(false);

    const on = loadConfig(`
plugins:
  - id: session
    name: "@flintloom/session"
`);
    expect(on.plugins[0]?.enabled).toBeUndefined();

    expect(() =>
      loadConfig(`
plugins:
  - id: session
    name: "@flintloom/session"
    enabled: "false"
`),
    ).toThrow(/enabled/);
  });
```

`apply-config.test.ts` 追加：

```ts
  it("enabled false 不 import 但仍占用 id", async () => {
    const ctx = new Context();
    const imported: string[] = [];
    await applyConfig(
      ctx,
      {
        plugins: [
          { id: "a", name: "pkg-a", enabled: false },
          { id: "b", name: "pkg-b" },
        ],
      },
      {
        importFn: async (name) => {
          imported.push(name);
          return plugin(name, (c) => {
            c.provide(name, true);
          });
        },
      },
    );
    expect(imported).toEqual(["pkg-b"]);
    expect(ctx.get("pkg-a")).toBeUndefined();
    expect(ctx.require("pkg-b")).toBe(true);

    await expect(
      applyConfig(
        ctx,
        {
          plugins: [
            { id: "a", name: "pkg-a", enabled: false },
            { id: "a", name: "pkg-a2" },
          ],
        },
        { importFn: async () => plugin("x", () => {}) },
      ),
    ).rejects.toThrow(/id/);
  });
```

`mcp-servers.test.ts` 在 `loadMcpServersFile` 追加 enabled 用例；在 merge 追加：

```ts
  it("skips enabled false servers when merging", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-mcp-off-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-mcp-off-home-"));
    writeFileSync(
      join(workspaceRoot, MCP_SERVERS_WORKSPACE_FILE),
      `servers:
  - id: fake
    command: node
    enabled: false
  - id: live
    command: node
`,
      "utf8",
    );
    const merged = mergeMcpServersIntoConfig(
      { plugins: [{ id: "tools", name: "@flintloom/tools" }] },
      { workspaceRoot, homeDir },
    );
    expect(merged.plugins.map((p) => p.id)).toEqual(["tools", "live"]);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @flintloom/kernel exec vitest run tests/config.test.ts tests/apply-config.test.ts tests/mcp-servers.test.ts`

Expected: FAIL（`enabled` 未解析 / 禁用行仍被 merge）

- [ ] **Step 3: Minimal implementation**

在 `config.ts` / `mcp-servers.ts` 共用同一规则（可各写 8 行，不要新依赖）：

```ts
if (row.enabled !== undefined) {
  if (typeof row.enabled !== "boolean") {
    throw new Error("enabled");
  }
  if (row.enabled === false) {
    pluginRow.enabled = false;
  }
}
```

`apply-config.ts` 循环里：`seen.add(row.id)` 之后，若 `row.enabled === false` 则 `continue`（不 `importFn`）。

`mergeMcpServersIntoConfig` 里 `toPluginRow` 之前：`if (server.enabled === false) continue;`。

- [ ] **Step 4: Run tests to verify they pass**

Run: 同 Step 2

Expected: PASS

- [ ] **Step 5: Commit**

```powershell
git add packages/kernel/src/config.ts packages/kernel/src/apply-config.ts packages/kernel/src/mcp-servers.ts packages/kernel/tests/config.test.ts packages/kernel/tests/apply-config.test.ts packages/kernel/tests/mcp-servers.test.ts
git commit -m @"
feat(kernel): 解析 enabled 并跳过禁用插件与 MCP

flintloom.yml 与 mcp-servers.yml 支持 enabled: false；关闭的行不 apply、不 merge 进组装，id 仍占用以防重复。
"@
```

---

### Task 2: `pluginKind` 与 MCP 状态表键

**Files:**
- Create: `packages/kernel/src/plugin-kind.ts`
- Modify: `packages/kernel/src/mcp-servers.ts`
- Modify: `packages/kernel/src/index.ts`
- Test: `packages/kernel/tests/plugin-kind.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:

```ts
export type PluginKind = "core" | "optional" | "channel" | "search" | "mcp";

export function pluginKind(row: { id: string; name: string }): PluginKind;
export function isPluginToggleable(row: { id: string; name: string }): boolean;

export const MCP_SERVER_STATUS_KEY = "mcp-server-status";
export type McpServerRuntimeStatus = {
  status: "loaded" | "error";
  error?: string;
  tools: string[];
};
```

内核 id 集合（与 spec §2 一致）：`models` `tools` `session` `models-chat` `models-media` `models-guard` `loop` `fs` `grep` `shell`。渠道：`id === "channel"` 或 `id.startsWith("channel-")`。`web-search` → `search`。`name === "@flintloom/mcp"` → `mcp`。其余 `optional`。仅 `optional` 的 `isPluginToggleable` 为 true。

`MCP_PLUGIN_NAME` 已在 `mcp-servers.ts` 用 `WORKSPACE_ROOT_OVERLAY_PACKAGES[0]`，`pluginKind` 比较 `row.name` 时用同一常量（从 `plugin-overlay.ts` import，不要在 host 复制字符串）。

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { isPluginToggleable, pluginKind } from "../src/index.ts";

describe("pluginKind", () => {
  it("classifies core channel search mcp optional", () => {
    expect(pluginKind({ id: "loop", name: "@flintloom/loop" })).toBe("core");
    expect(pluginKind({ id: "fs", name: "@flintloom/fs" })).toBe("core");
    expect(pluginKind({ id: "channel-telegram", name: "@flintloom/channel-telegram" })).toBe("channel");
    expect(pluginKind({ id: "web-search", name: "@flintloom/web-search" })).toBe("search");
    expect(pluginKind({ id: "fake", name: "@flintloom/mcp" })).toBe("mcp");
    expect(pluginKind({ id: "weather", name: "@flintloom/weather" })).toBe("optional");
    expect(pluginKind({ id: "my-plugin", name: "C:/plugins/x" })).toBe("optional");
    expect(isPluginToggleable({ id: "weather", name: "@flintloom/weather" })).toBe(true);
    expect(isPluginToggleable({ id: "loop", name: "@flintloom/loop" })).toBe(false);
    expect(isPluginToggleable({ id: "web-search", name: "@flintloom/web-search" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @flintloom/kernel exec vitest run tests/plugin-kind.test.ts`

Expected: FAIL（模块不存在）

- [ ] **Step 3: Implement `plugin-kind.ts`，导出 `MCP_SERVER_STATUS_KEY` / `McpServerRuntimeStatus`**

在 `mcp-servers.ts` 底部 export 状态键与类型；`index.ts` 从 `plugin-kind.ts` 与 `mcp-servers.ts` 再导出。

- [ ] **Step 4: Run test to verify it passes**

Expected: PASS

- [ ] **Step 5: Commit**

```powershell
git add packages/kernel/src/plugin-kind.ts packages/kernel/src/mcp-servers.ts packages/kernel/src/index.ts packages/kernel/tests/plugin-kind.test.ts
git commit -m @"
feat(kernel): 插件 kind 分类与 MCP 状态表键

为后续能力开关和 host 读取 MCP 运行状态提供唯一分类函数与上下文键名。
"@
```

---

### Task 3: 工作区 `mcp-servers.yml` 原子读写

**Files:**
- Create: `packages/kernel/src/yaml-atomic.ts`
- Create: `packages/kernel/src/mcp-servers-write.ts`
- Modify: `packages/kernel/src/install-plugin.ts`（改 import `replaceYmlAtomic`）
- Modify: `packages/kernel/src/index.ts`
- Test: `packages/kernel/tests/mcp-servers-write.test.ts`
- Test: 现有 `packages/kernel/tests/install-plugin.test.ts` 必须仍绿

**Interfaces:**
- Consumes: `loadMcpServersFile`、`isPluginId`、Task 1 的 `McpServerRow`
- Produces:

```ts
export function replaceYmlAtomic(ymlPath: string, dumped: string): void;

export type McpServerDeclaration = McpServerRow & {
  enabled: boolean;
  source: "workspace" | "home";
  writable: boolean;
};

export function listMcpServerDeclarations(opts: {
  workspaceRoot: string;
  homeDir: string;
}): McpServerDeclaration[];

export function upsertWorkspaceMcpServer(
  workspaceRoot: string,
  server: McpServerRow,
): void;

export function deleteWorkspaceMcpServer(workspaceRoot: string, id: string): void;

export function setWorkspaceMcpEnabled(
  workspaceRoot: string,
  id: string,
  enabled: boolean,
): void;
```

规则：

- `listMcpServerDeclarations`：home 先、workspace 覆盖同 id；`source` 以最终条目来源为准；仅 workspace 文件里的 id `writable: true`。`enabled` 缺省 true。
- `upsert`：无文件则写 `servers: []` 再追加。dump 时 `enabled === true` 或 undefined **不要**输出 `enabled` 键。写回前 `loadMcpServersFile` 校验。
- `setWorkspaceMcpEnabled(id, true)`：删除该键。`false`：写入 `enabled: false`。id 不在工作区文件 → throw `"home"`（与 spec 改个人条目一致；调用方也可先区分）。
- `deleteWorkspaceMcpServer`：id 不在工作区 → throw `"home"`。
- 用 `parseDocument` 尽量保留注释。

- [ ] **Step 1: Write the failing tests**

覆盖：list 合并与 writable；upsert 创建文件；setEnabled false 文件含 `enabled: false`；再 true 文件无 `enabled:`；delete；对仅 home 的 id 操作抛 `home`。

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @flintloom/kernel exec vitest run tests/mcp-servers-write.test.ts`

Expected: FAIL

- [ ] **Step 3: Implement yaml-atomic + mcp-servers-write；install-plugin 改用抽出的 `replaceYmlAtomic`**

- [ ] **Step 4: Run kernel tests**

Run: `pnpm --filter @flintloom/kernel test`

Expected: PASS

- [ ] **Step 5: Commit**

```powershell
git add packages/kernel/src/yaml-atomic.ts packages/kernel/src/mcp-servers-write.ts packages/kernel/src/install-plugin.ts packages/kernel/src/index.ts packages/kernel/tests/mcp-servers-write.test.ts packages/kernel/tests/install-plugin.test.ts
git commit -m @"
feat(kernel): 原子读写工作区 mcp-servers.yml

抽出 YAML 原子替换，并提供 MCP 条目的列出、写入、开关和删除，打开时不把 enabled: true 写回文件。
"@
```

---

### Task 4: MCP `apply` 故障隔离

**Files:**
- Modify: `packages/mcp/src/index.ts`
- Test: `packages/mcp/tests/plugin.test.ts`

**Interfaces:**
- Consumes: `MCP_SERVER_STATUS_KEY`、`McpServerRuntimeStatus`、现有 `validateMcpConfig` / `buildChildEnv` / `McpStdioClient`
- Produces: `apply` 始终 resolve（不 reject）；`ctx.get(MCP_SERVER_STATUS_KEY)` 含该 id

把现有用例 `rejects missing declared env at apply` **改成**不抛，并断言无 `mcp__fake__echo`、状态 `error`、`error` 含 `MISSING_ENV`、不含 token。

再追加：坏 command（`command: "__flintloom_no_such_cmd__"`）不抛；同 ctx 上先挂 models+tools 仍在；`error` 短消息。

成功路径仍登记工具，状态 `loaded`，`tools` 含 `mcp__fake__echo`。

实现要点：

```ts
function statusTable(ctx: Context): Map<string, McpServerRuntimeStatus> {
  let table = ctx.get<Map<string, McpServerRuntimeStatus>>(MCP_SERVER_STATUS_KEY);
  if (table === undefined) {
    table = new Map();
    ctx.provide(MCP_SERVER_STATUS_KEY, table);
  }
  return table;
}

function publicMcpError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("missing env:")) {
    return message.replace(/missing env:\s*/, "missing env: ").trim();
  }
  if (message.includes("timeout")) return "timeout";
  if (message === "id" || message === "command" || message === "args" || message === "env" || message === "workspaceRoot") {
    return message;
  }
  return "mcp";
}
```

`apply`：try 校验 + env + initialize + register；catch 里 `client?.kill()`、`table.set(id, { status: "error", error: publicMcpError(err), tools: [] })`。id 若校验失败可用 `typeof config.id === "string" ? config.id : "invalid"`。

- [ ] **Step 1: Rewrite failing/changed tests**
- [ ] **Step 2: Run `pnpm --filter @flintloom/mcp exec vitest run tests/plugin.test.ts`** — 缺 env 用例会 FAIL（不再 reject）
- [ ] **Step 3: Implement isolate in `index.ts`**
- [ ] **Step 4: Run mcp tests — PASS**
- [ ] **Step 5: Commit**

```powershell
git add packages/mcp/src/index.ts packages/mcp/tests/plugin.test.ts
git commit -m @"
fix(mcp): 单台 MCP 启动失败不再拖垮组装

缺环境变量、超时或坏 command 时只写入错误状态、不登记工具，其它插件继续加载。
"@
```

---

### Task 5: 原子 `reloadRuntime`

**Files:**
- Modify: `apps/host/src/server.ts`（`reloadRuntime` 约 1573–1580 行）
- Test: `apps/host/tests/server.test.ts`

**Interfaces:**
- Consumes: 现有 `createRuntime` / `startHost`
- Produces: `reloadRuntime` 在 `createRuntime` 抛错时不 `stop` 旧实例

```ts
const reloadRuntime = async (): Promise<void> => {
  const next = await createRuntime(workspaceRootRef.current, opts.homeDir, {
    pollChannels: true,
  });
  const prev = runtimeRef.current;
  runtimeRef.current = next;
  busyRef.current = next.ctx.require<Set<string>>("turnBusy");
  fileWatch.setRoot(workspaceRootRef.current);
  prev.stop();
};
```

- [ ] **Step 1: Write the failing test**

在 `startHost` describe 里：

```ts
  it("reload keeps old runtime when createRuntime fails", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-host-reload-keep-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-host-reload-keep-home-"));
    writeAssembly(workspaceRoot);
    const host = await startHost({ workspaceRoot, homeDir, port: 0 });
    close = host.close;
    const token = loadOrCreateToken(homeDir);
    writeFileSync(join(workspaceRoot, "flintloom.yml"), "foo: 1\n");
    const reload = await fetch(`${host.url}/v1/settings/reload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(reload.status).toBe(500);
    const models = await fetch(`${host.url}/v1/models`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(models.status).toBe(200);
  });
```

现网会先 `stop` 再失败，`GET /v1/models` 走 `ctx.require("models")` 会 500。

- [ ] **Step 2: Run the test — FAIL（models 不是 200）**

Run: `pnpm --filter @flintloom/host exec vitest run tests/server.test.ts -t "reload keeps old runtime"`

- [ ] **Step 3: 改 `reloadRuntime` 顺序**
- [ ] **Step 4: 该测试 PASS；`POST /v1/settings/reload returns 409 when busy` 仍绿**
- [ ] **Step 5: Commit**

```powershell
git add apps/host/src/server.ts apps/host/tests/server.test.ts
git commit -m @"
fix(host): 重载失败时保留旧运行时

先 createRuntime 成功再 stop 旧实例，避免坏配置把工作台停在半死状态。
"@
```

---

### Task 6: `/v1/mcp-servers` HTTP

**Files:**
- Create: `apps/host/src/mcp-servers-http.ts`
- Modify: `apps/host/src/server.ts`（在已授权的 `/v1/` 分支里 `handleMcpServersRequest`，紧挨 `GET /v1/plugins` 之前）
- Test: `apps/host/tests/server.test.ts`

**Interfaces:**
- Consumes: `listMcpServerDeclarations`、`upsertWorkspaceMcpServer`、`deleteWorkspaceMcpServer`、`setWorkspaceMcpEnabled`、`MCP_SERVER_STATUS_KEY`、`reloadRuntime`、`isPluginId`、`loadConfig`
- Produces: spec §5.1–5.2 的 JSON

`handleMcpServersRequest` 返回 `boolean`（是否已处理），签名对齐 `handlePluginInstallRequest`。

GET 合并声明 + 状态表：

- 声明 `enabled === false` → `status: "disabled"`，`tools: []`，`error: null`
- 否则读 `Map.get(id)`：无记录视为 `loaded`+空 tools（尚未 apply 的瞬间）；`error` 则 `status: "error"`
- `enabled` JSON 字段始终布尔（缺省 true）

POST body `{ id, command, args?, env? }`：id 与 `loadConfig(flintloom.yml).plugins` 的 id 冲突、或 `listMcpServerDeclarations` 已有 id → 400 `"id"`。先 upsert 再：若 `busy.size > 0` → 409 JSON；否则 `await reloadRuntime()`。

PUT `/v1/mcp-servers/:id`：只改 command/args/env；body 含 `enabled` → 400。不可写 → 400 `"home"`。

PATCH：`{ enabled: boolean }` only。

DELETE：工作区删除。

POST `/v1/mcp-servers/:id/copy`：从 list 里找 `source==="home"` 且 `writable===false` 的条目，upsert 到工作区（不要 `enabled: true` 键）。工作区已有 → 400 `"id"`。

401：走现有 `pathname.startsWith("/v1/") && !isAuthorized`。

host 源码扫描：本文件与 `server.ts` **不要**出现 `mcp__` 字面量。

- [ ] **Step 1: Write HTTP tests**（均 `Authorization: Bearer`）

  1. GET 无文件 → `{ servers: [] }`；无 token → 401  
  2. 工作区假 server + `.env` FAKE_TOKEN：GET 含 `status: "loaded"` 且 `tools` 含 echo 名（断言用变量拼 `mcp__` + id + `__echo`，测试文件允许 `mcp__`）  
  3. 同文件再加 `id: bad` `command: __no_such__`：GET 里 bad 为 `error`，假 server 仍 loaded；`createRuntime` 不抛  
  4. POST 假 server → 200，磁盘有 yml，GET 能见到  
  5. POST 与 yml 插件 id `tools` 冲突 → 400，无 mcp-servers.yml 或未写入该 id  
  6. PATCH enabled false → GET `disabled`，runtime schema 无该工具（再 `createRuntime` 或 GET 后查 tools 列表来自 GET 的 `tools: []`）  
  7. DELETE → GET 无该 id  
  8. home-only：写 `homeDir/.flintloom/mcp-servers.yml`，PUT → 400 `home`；copy → 工作区文件有该 id，`writable: true`  
  9. `turnBusy.add` 后 POST → 409，`JSON.parse` 得 `written: true`，磁盘已有新 id  

- [ ] **Step 2: Run tests — FAIL（404）**
- [ ] **Step 3: Implement handler + wire in `handleRequest`**
- [ ] **Step 4: host tests PASS；`apps/host/src` 扫描无 `@flintloom/mcp` 与 `mcp__` 仍绿**
- [ ] **Step 5: Commit**

```powershell
git add apps/host/src/mcp-servers-http.ts apps/host/src/server.ts apps/host/tests/server.test.ts
git commit -m @"
feat(host): 增加 mcp-servers HTTP 管理接口

工作区可增删改开关 stdio MCP；busy 时配置已写入并返回 JSON；坏 server 只出现在列表的 error 状态。
"@
```

---

### Task 7: 桌面插件页 MCP 块

**Files:**
- Modify: `apps/desktop/src/api.ts`
- Modify: `apps/desktop/src/PluginsPane.tsx`
- Modify: `apps/desktop/tests/App.test.tsx`（`installFetch` 增加 `mcpServers`；更新「shows plugin list」）
- Modify: `apps/desktop/src/app.css`（仅必要时，复用 `settings-card`）

**Interfaces:**
- Consumes: `/v1/mcp-servers*`
- Produces:

```ts
export type McpServerSnapshot = {
  id: string;
  command: string;
  args: string[];
  env: string[];
  enabled: boolean;
  source: "workspace" | "home";
  writable: boolean;
  status: "loaded" | "disabled" | "error";
  tools: string[];
  error: string | null;
};

export function fetchMcpServers(signal?: AbortSignal): Promise<{ servers: McpServerSnapshot[] }>;
export function createMcpServer(body: { id: string; command: string; args?: string[]; env?: string[] }): Promise<void>;
export function updateMcpServer(id: string, body: { command: string; args?: string[]; env?: string[] }): Promise<void>;
export function setMcpServerEnabled(id: string, enabled: boolean): Promise<{ written?: boolean; busy?: boolean }>;
export function deleteMcpServer(id: string): Promise<void>;
export function copyMcpServer(id: string): Promise<void>;
```

409：解析 JSON，若 `written` 则 throw `Error("busy")` 并让 UI 显示「已保存，对话结束后重载」+ 调用现有 `reloadHostSettings`。其它 400 用响应文本（`id`/`command`/`home`）。

UI（`PluginsPane`）：

1. 顶栏：host unreachable；busy 条；「重载 host」按钮（`reloadHostSettings`）。
2. MCP 卡片列表。空态：「添加服务器」。工作区：开关、编辑表单（id 创建后只读）、删除确认。展开只读 tools / error。个人：标签「个人」、只读、「复制到工作区」。
3. 内核表：继续 `GET /v1/plugins`，**过滤** `name === "@flintloom/mcp"`（避免与 MCP 块重复）。可默认折叠。
4. 不要第二套「联网」按钮。页脚可写 `mcp-servers.yml` 路径提示（已有文案可改短）。

`installFetch`：`/v1/mcp-servers` 默认 `{ servers: [] }`。现有测试 `shows plugin list on Plugins page` 改为：loop 仍可见；MCP 行若只在 plugins 里则内核表不显示 fake，或同时 mock mcpServers 含 fake 并断言 MCP 块文案。

追加测试：mock 一台 `status: "error"` → 页面含短错误、不含 token；有「添加服务器」。

- [ ] **Step 1: 改测试（现有插件页用例会 FAIL 若仍找 `.plugin-tag.mcp` 在内核表）**
- [ ] **Step 2: Run `pnpm --filter @flintloom/desktop exec vitest run tests/App.test.tsx -t "plugin"` — FAIL**
- [ ] **Step 3: api + PluginsPane**
- [ ] **Step 4: desktop tests PASS**
- [ ] **Step 5: Commit**

```powershell
git add apps/desktop/src/api.ts apps/desktop/src/PluginsPane.tsx apps/desktop/src/app.css apps/desktop/tests/App.test.tsx
git commit -m @"
feat(desktop): 插件页可管理 MCP 服务器

在插件页增删改开关工作区 MCP，个人目录条目只读可复制；坏 server 只在该行显示错误。
"@
```

---

### Task 8: 更新 `docs/mcp-servers.md`

**Files:**
- Modify: `docs/mcp-servers.md`

把「只能手写 YAML」改为：桌面插件页可管理；YAML 仍是真相；补充 `enabled: false`；启动失败改为「该 server 失败，其它照常」；指向插件页。不要写对照产品名。

- [ ] **Step 1: 编辑文档**
- [ ] **Step 2: 通读与 spec §5 一致**
- [ ] **Step 3: Commit**

```powershell
git add docs/mcp-servers.md
git commit -m @"
docs: 说明插件页管理 MCP 与 enabled 字段

文档与实现一致：可在工作台增删开关 stdio MCP，单台失败不再阻止启动。
"@
```

---

### Task 9: 回归

- [ ] **Step 1:** `pnpm test`
- [ ] **Step 2:** `pnpm typecheck`
- [ ] **Step 3:** 手工（可选）：`pnpm desktop` 加假 server → 对话 echo；改错 command → 聊天仍可发、该行红。

Expected: 全绿。

不要空 commit。若无文件变更则跳过。
