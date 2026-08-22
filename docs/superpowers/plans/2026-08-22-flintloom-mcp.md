# FlintLoom MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户在工作区 `flintloom.yml` 自行加 `@flintloom/mcp` 行后，host  spawn stdio MCP 子进程，`initialize` + `tools/list` 把工具登记为 `mcp__<id>__<name>`；模型调用走 `tools/call`，结果经现有 `tool/result` 进 session。默认组装不含 MCP 行。

**Architecture:** 先改 kernel：`apply` 可异步、`applyConfig` 注入 `id` 并 `await`。新 `@flintloom/mcp` 包：自写 Content-Length JSON-RPC 客户端 + async `apply`（spawn、登记工具、effect 杀进程）。`createRuntime` 对 MCP 行 overlay `workspaceRoot`。host **不** import 该包；根 `devDependencies` 仅用于 `import(name)` 解析。

**Tech Stack:** 现有 kernel / tools、`node:child_process`、`node:readline` 或自缓冲 stdin。Vitest。不引入 `@modelcontextprotocol/sdk`。测试用 `process.execPath` + 仓内夹具脚本，不打网。

## Global Constraints

- 产品名 FlintLoom；包前缀 `@flintloom/*`。禁止往 `createRuntime` 里 `register` 工具。
- 不 import / submodule / 拷贝 dataagent-v3、deepseek-harness、Cordis。
- 不做 HTTP、桌面 MCP 页、resources / prompts、HTTP/SSE MCP、真实 GitHub/Slack server。
- 默认 `flintloom.yml` 与 `ASSEMBLY` **不加** MCP 行。根 `package.json` 加 `@flintloom/mcp` 到 `devDependencies`。
- `apps/host/src` 不得出现 `@flintloom/mcp`、`createMcp`、`mcp__`（连 `import type` 也不要）。
- 子进程 env：基线 OS 变量 ∪ `config.env` 声明名；**永不**传 `FLINTLOOM_*`。失败文案不得含 env **值**、API key、token、绝对 `homeDir`。
- 测试夹具：`process.execPath` + 仓内脚本。不要 `npx`、不要网络。
- Windows：指定文件 `git add`；不要 `git add -A`。不要提交 `check_libs.py`、`scripts/desktop-dev.ts`。PowerShell 用 `git commit -m @"` / `"@`。不要用 `&&`。
- Spec：`docs/superpowers/specs/2026-08-22-flintloom-mcp-design.md`

## File map

```text
packages/kernel/src/context.ts           # async apply; plugin() → Disposer | Promise<Disposer>
packages/kernel/src/apply-config.ts    # merged.id; await plugin()
packages/kernel/tests/context.test.ts  # async apply + rollback
packages/kernel/tests/apply-config.test.ts  # id 注入; async apply

packages/mcp/package.json
packages/mcp/fixtures/fake-mcp-server.mjs   # 假 stdio server（echo）
packages/mcp/src/frame.ts                   # Content-Length 成帧
packages/mcp/src/env.ts                     # buildChildEnv
packages/mcp/src/client.ts                # McpStdioClient
packages/mcp/src/config.ts                  # validateMcpConfig
packages/mcp/src/tools.ts                   # registerMcpTools
packages/mcp/src/index.ts                   # async apply
packages/mcp/tests/frame.test.ts
packages/mcp/tests/client.test.ts
packages/mcp/tests/env.test.ts
packages/mcp/tests/config.test.ts
packages/mcp/tests/plugin.test.ts

package.json                             # devDependency @flintloom/mcp
pnpm-lock.yaml                           # pnpm install
apps/host/src/server.ts                  # overlay workspaceRoot per MCP row
apps/host/tests/server.test.ts           # 禁 import; 默认无 mcp__; 夹具集成
```

不改 `runTurn`、desktop、loop、DocForge、通道。不改默认 `flintloom.yml` / `ASSEMBLY`。

---

### Task 1: kernel 异步 `apply` 与 `id` 注入

**Files:**
- Modify: `packages/kernel/src/context.ts`
- Modify: `packages/kernel/src/apply-config.ts`
- Modify: `packages/kernel/tests/context.test.ts`
- Modify: `packages/kernel/tests/apply-config.test.ts`

**Interfaces:**
- Consumes: 现有 `Context`、`FlintPlugin`
- Produces:

```ts
// context.ts
export interface FlintPlugin {
  name: string;
  apply(ctx: Context, config: Record<string, unknown>): void | Promise<void>;
}

// plugin() 同步路径仍返回 Disposer；异步路径返回 Promise<Disposer>
plugin(
  plugin: FlintPlugin,
  config?: Record<string, unknown>,
): Disposer | Promise<Disposer>;

// apply-config.ts — merged 在 spread 之后写入 id
const merged = { ...(row.config ?? {}), ...(runtime[row.id] ?? {}), id: row.id };
const disposer = await Promise.resolve(ctx.plugin(plugin, merged));
```

- [ ] **Step 1: Write the failing tests**

在 `packages/kernel/tests/apply-config.test.ts` 的「按行 apply 并合并 runtime config」里，把期望改为含 `id`：

```ts
    expect(seen[0]).toEqual({ fromYml: 1, apiKey: "k", id: "a" });
```

追加：

```ts
  it("异步 apply 成功后工具已登记；失败则回滚", async () => {
    const ctx = new Context();
    const mods: Record<string, FlintPlugin> = {
      async: {
        name: "async",
        async apply(c) {
          c.provide("async.ok", true);
          await Promise.resolve();
        },
      },
      asyncFail: {
        name: "async-fail",
        async apply(c) {
          c.provide("async-fail.k", 1);
          throw new Error("async-boom");
        },
      },
    };

    const stop = await applyConfig(
      ctx,
      { plugins: [{ id: "async", name: "pkg-async" }] },
      { importFn: async () => mods.async },
    );
    expect(ctx.require("async.ok")).toBe(true);
    stop();

    const ctx2 = new Context();
    await expect(
      applyConfig(
        ctx2,
        { plugins: [{ id: "fail", name: "pkg-async-fail" }] },
        { importFn: async () => mods.asyncFail },
      ),
    ).rejects.toThrow(/async-boom/);
    expect(() => ctx2.require("async-fail.k")).toThrow(/async-fail\.k/);
  });
```

在 `packages/kernel/tests/context.test.ts` 追加：

```ts
  it("异步 apply 返回 Promise<Disposer>", async () => {
    const ctx = new Context();
    const stopPromise = ctx.plugin({
      name: "async",
      async apply(c) {
        c.provide("async.n", 9);
        await Promise.resolve();
      },
    });
    expect(stopPromise).toBeInstanceOf(Promise);
    const stop = await stopPromise;
    expect(ctx.get("async.n")).toBe(9);
    stop();
    expect(ctx.get("async.n")).toBeUndefined();
  });

  it("异步 apply 失败回滚 effect", async () => {
    const ctx = new Context();
    await expect(
      ctx.plugin({
        name: "async-boom",
        async apply(c) {
          c.provide("async-boom.k", 1);
          throw new Error("async-apply-fail");
        },
      }),
    ).rejects.toThrow(/async-apply-fail/);
    expect(() => ctx.require("async-boom.k")).toThrow(/async-boom\.k/);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run packages/kernel/tests/apply-config.test.ts packages/kernel/tests/context.test.ts`

Expected: FAIL（`id` 未注入；`ctx.plugin` 不返回 Promise）。

- [ ] **Step 3: Minimal implementation**

`packages/kernel/src/context.ts`：

- `FlintPlugin.apply` 类型改为 `void | Promise<void>`。
- `plugin()`：调用 `apply` 后若结果为 thenable，返回 `Promise<Disposer>`；reject 时与同步 throw 相同，回滚 `before` 之后登记的 disposer。同步路径不变。

`packages/kernel/src/apply-config.ts`：

```ts
      const merged = { ...(row.config ?? {}), ...(runtime[row.id] ?? {}), id: row.id };
      stops.push(await Promise.resolve(ctx.plugin(plugin, merged)));
```

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run packages/kernel/tests`

Expected: PASS。

Run: `pnpm typecheck`

Expected: exit 0。

- [ ] **Step 5: Commit**

```powershell
git add packages/kernel/src/context.ts packages/kernel/src/apply-config.ts packages/kernel/tests/context.test.ts packages/kernel/tests/apply-config.test.ts
git commit -m @"
feat(kernel): await async plugin apply and inject plugin id
"@
```

---

### Task 2: Content-Length 成帧与 stdio JSON-RPC 客户端

**Files:**
- Create: `packages/mcp/package.json`
- Create: `packages/mcp/fixtures/fake-mcp-server.mjs`
- Create: `packages/mcp/src/frame.ts`
- Create: `packages/mcp/src/client.ts`
- Create: `packages/mcp/tests/frame.test.ts`
- Create: `packages/mcp/tests/client.test.ts`

**Interfaces:**
- Consumes: `node:child_process.spawn`、`node:path`
- Produces:

```ts
// frame.ts
export function encodeFrame(payload: unknown): Buffer;
export function createFrameReader(
  onMessage: (msg: Record<string, unknown>) => void,
): { push(chunk: Buffer): void };

// client.ts
export const MCP_INIT_TIMEOUT_MS = 8_000;
export const MCP_CALL_TIMEOUT_MS = 30_000;

export type McpTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

export class McpStdioClient {
  constructor(opts: {
    command: string;
    args: string[];
    cwd: string;
    env: Record<string, string>;
  });
  initialize(): Promise<void>;   // initialize + notifications/initialized + tools/list
  listTools(): McpTool[];
  callTool(
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<string>;            // 拼接 text content；RPC/超时 → throw
  kill(): void;
}
```

夹具 `fixtures/fake-mcp-server.mjs` 行为：

- 读 stdin Content-Length 帧。
- `initialize` → `{ protocolVersion: "2024-11-05", capabilities: { tools: {} } }`。
- `notifications/initialized` → 无响应。
- `tools/list` → 一个工具 `echo`，`inputSchema` 含 `text` string。
- `tools/call` 且 `params.name === "echo"` → `content: [{ type: "text", text: params.arguments.text }]`.
- 其它 method → JSON-RPC error。

- [ ] **Step 1: Write the failing tests**

`packages/mcp/package.json`：

```json
{
  "name": "@flintloom/mcp",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@flintloom/kernel": "workspace:*",
    "@flintloom/tools": "workspace:*"
  }
}
```

`packages/mcp/tests/frame.test.ts`：测 `encodeFrame` 头格式、`createFrameReader` 多帧与半包。

`packages/mcp/tests/client.test.ts`：

```ts
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { McpStdioClient } from "../src/client.ts";

const fixture = join(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/fake-mcp-server.mjs",
);

describe("McpStdioClient", () => {
  it("initializes and lists echo tool", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "flintloom-mcp-cwd-"));
    const client = new McpStdioClient({
      command: process.execPath,
      args: [fixture],
      cwd,
      env: { FAKE_TOKEN: "secret-value" },
    });
    await client.initialize();
    expect(client.listTools().map((t) => t.name)).toContain("echo");
    client.kill();
  });

  it("callTool echoes text without leaking env values", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "flintloom-mcp-call-"));
    const client = new McpStdioClient({
      command: process.execPath,
      args: [fixture],
      cwd,
      env: { FAKE_TOKEN: "secret-value" },
    });
    await client.initialize();
    const out = await client.callTool(
      "echo",
      { text: "hi" },
      new AbortController().signal,
    );
    expect(out).toBe("hi");
    expect(out).not.toContain("secret-value");
    client.kill();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run packages/mcp/tests/frame.test.ts packages/mcp/tests/client.test.ts`

Expected: FAIL（模块不存在）。

- [ ] **Step 3: Minimal implementation**

`frame.ts`：按 spec 写 `Content-Length: <utf8 bytes>\r\n\r\n` 成帧；reader 缓冲直到完整帧。

`client.ts`：

- spawn 子进程；stdin 写帧；stdout 用 reader。
- `initialize`：`protocolVersion: "2024-11-05"` → 通知 `notifications/initialized` → `tools/list`；整段 8s 超时。
- `callTool`：`tools/call`；尊重 `signal.aborted`；30s 上限；只拼 `type==="text"` 的 `text`；总长 > 200_000 截断 + `\n\n[truncated]`。
- stderr 丢弃。
- `kill()`：杀子进程（含在飞 call）。

实现夹具脚本（纯 Node，无依赖）。

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run packages/mcp/tests`

Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add packages/mcp/package.json packages/mcp/fixtures/fake-mcp-server.mjs packages/mcp/src/frame.ts packages/mcp/src/client.ts packages/mcp/tests/frame.test.ts packages/mcp/tests/client.test.ts
git commit -m @"
feat(mcp): add stdio JSON-RPC client and fake fixture server
"@
```

---

### Task 3: env 校验、`apply` 与工具登记

**Files:**
- Create: `packages/mcp/src/env.ts`
- Create: `packages/mcp/src/config.ts`
- Create: `packages/mcp/src/tools.ts`
- Create: `packages/mcp/src/index.ts`
- Create: `packages/mcp/tests/env.test.ts`
- Create: `packages/mcp/tests/config.test.ts`
- Create: `packages/mcp/tests/plugin.test.ts`

**Interfaces:**

```ts
// env.ts
export const BASELINE_ENV_NAMES = [
  "PATH", "PATHEXT", "SYSTEMROOT", "COMSPEC", "HOME", "USERPROFILE", "TMP", "TEMP",
] as const;

export function buildChildEnv(input: {
  declared: string[];
  envValues?: Record<string, string>;
}): Record<string, string>;

// config.ts
export type McpConfig = {
  id: string;
  command: string;
  args: string[];
  env: string[];
  envValues?: Record<string, string>;
  workspaceRoot: string;
};

export function validateMcpConfig(raw: Record<string, unknown>): McpConfig;

// tools.ts
export function registerMcpTools(input: {
  tools: ToolRegistry;
  id: string;
  client: McpStdioClient;
}): () => void;  // disposer
```

`validateMcpConfig` 规则（与 spec 5.3 一致）：

- `id`：`isPluginId`，否则 `throw new Error("id")`。
- `command`：非空 string，否则 `throw new Error("command")`。
- `args`：缺省 `[]`；出现则必须 `string[]`。
- `env`：缺省 `[]`；出现则必须 `string[]`；元素 trim 后非空；任何 `FLINTLOOM_*` → `throw new Error("env")`。
- `workspaceRoot`：非空 string，否则 `throw new Error("workspaceRoot")`。
- `buildChildEnv`：基线 ∪ 声明名；值 `envValues[name] ?? process.env[name]`；缺任一声明名 → `throw new Error` 消息含 env **名**、不含值。

`registerMcpTools`：

- MCP 工具名须 `/^[a-zA-Z0-9_-]+$/`，否则跳过。
- 登记名 `mcp__${id}__${tool}`；`parameters` = `inputSchema` 或 `{ type: "object", properties: {} }`。
- `execute`：args 原样作 MCP `arguments`；成功返回文本；RPC/超时/非零退出 → `failed: mcp`；`signal.aborted` → `aborted`。

`index.ts` async `apply`：

```ts
const plugin: FlintPlugin = {
  name: "@flintloom/mcp",
  async apply(ctx, config) {
    const tools = ctx.require<ToolRegistry>("tools");
    const cfg = validateMcpConfig(config);
    const childEnv = buildChildEnv({ declared: cfg.env, envValues: cfg.envValues });
    const client = new McpStdioClient({
      command: cfg.command,
      args: cfg.args,
      cwd: cfg.workspaceRoot,
      env: childEnv,
    });
    await client.initialize();
    const unregister = registerMcpTools({ tools, id: cfg.id, client });
    ctx.effect(() => {
      unregister();
      client.kill();
    });
  },
};
```

- [ ] **Step 1: Write the failing tests**

`env.test.ts`：基线拷贝、`FLINTLOOM_*` 不进子进程 env、缺声明名抛错且消息含名不含值。

`config.test.ts`：合法配置、坏 id/command/env/workspaceRoot。

`plugin.test.ts`（用夹具 + 临时 Context）：

```ts
import modelsPlugin from "@flintloom/models";
import toolsPlugin from "@flintloom/tools";
// ... fixture path, mkdtemp ...

it("registers mcp__fake__echo and dispose removes it", async () => {
  const ctx = new Context();
  ctx.plugin(modelsPlugin);
  ctx.plugin(toolsPlugin);
  const workspaceRoot = mkdtempSync(...);
  const stop = await ctx.plugin(plugin, {
    id: "fake",
    command: process.execPath,
    args: [fixture],
    env: ["FAKE_TOKEN"],
    envValues: { FAKE_TOKEN: "tok" },
    workspaceRoot,
  });
  const tools = ctx.require<ToolRegistry>("tools");
  expect(tools.schemas().map((s) => s.name)).toContain("mcp__fake__echo");
  const out = await tools.execute(
    "mcp__fake__echo",
    { text: "hi" },
    { workspaceRoot, signal: new AbortController().signal, channel: "cli" },
  );
  expect(out).toBe("hi");
  stop();
  expect(tools.schemas().map((s) => s.name)).not.toContain("mcp__fake__echo");
});

it("rejects missing declared env at apply", async () => {
  const ctx = new Context();
  ctx.plugin(modelsPlugin);
  ctx.plugin(toolsPlugin);
  await expect(
    ctx.plugin(plugin, {
      id: "fake",
      command: process.execPath,
      args: [fixture],
      env: ["MISSING_ENV"],
      workspaceRoot: mkdtempSync(...),
    }),
  ).rejects.toThrow(/MISSING_ENV/);
});
```

注意：`ctx.plugin` 异步路径测试用 `await ctx.plugin(...)`。

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run packages/mcp/tests/env.test.ts packages/mcp/tests/config.test.ts packages/mcp/tests/plugin.test.ts`

Expected: FAIL。

- [ ] **Step 3: Minimal implementation**

按 Interfaces 实现 `env.ts`、`config.ts`、`tools.ts`、`index.ts`。导出 `default plugin` 与测试所需类型/函数。

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run packages/mcp`

Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add packages/mcp/src/env.ts packages/mcp/src/config.ts packages/mcp/src/tools.ts packages/mcp/src/index.ts packages/mcp/tests/env.test.ts packages/mcp/tests/config.test.ts packages/mcp/tests/plugin.test.ts
git commit -m @"
feat(mcp): validate config, spawn server, and register mcp tools
"@
```

---

### Task 4: host overlay、`devDependency` 与集成测试

**Files:**
- Modify: `package.json`（根 `devDependencies`）
- Modify: `pnpm-lock.yaml`（`pnpm install`）
- Modify: `apps/host/src/server.ts`
- Modify: `apps/host/tests/server.test.ts`

**不改** `flintloom.yml`、`apps/host/tests/assembly.ts`（默认组装无 MCP）。

- [ ] **Step 1: Write the failing tests**

在 `apps/host/tests/server.test.ts`：

1. `host src does not import tool factories` 末尾追加：

```ts
    expect(src).not.toMatch(/@flintloom\/mcp/);
    expect(src).not.toMatch(/createMcp/);
    expect(src).not.toMatch(/mcp__/);
```

2. 断言默认 `ASSEMBLY` 不含 `@flintloom/mcp`：

```ts
  it("default ASSEMBLY does not include mcp plugin", () => {
    expect(ASSEMBLY).not.toContain("@flintloom/mcp");
  });
```

3. 夹具集成（临时 yml，不打默认组装）：

```ts
  it("createRuntime loads mcp fixture and registers mcp__fake__echo", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-host-mcp-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-host-home-"));
    const fixture = fileURLToPath(
      new URL("../../../packages/mcp/fixtures/fake-mcp-server.mjs", import.meta.url),
    );
    writeFileSync(
      join(workspaceRoot, "flintloom.yml"),
      `plugins:
  - id: models
    name: "@flintloom/models"
  - id: tools
    name: "@flintloom/tools"
  - id: fake
    name: "@flintloom/mcp"
    config:
      command: ${JSON.stringify(process.execPath)}
      args: [${JSON.stringify(fixture)}]
      env: [FAKE_TOKEN]
`,
    );
    writeFileSync(
      join(workspaceRoot, ".env"),
      "FAKE_TOKEN=from-dotenv\n",
      "utf8",
    );
    const prev = process.env.FAKE_TOKEN;
    process.env.FAKE_TOKEN = "from-process";
    try {
      const { ctx, stop } = await createRuntime(workspaceRoot, homeDir);
      const names = ctx.require<ToolRegistry>("tools").schemas().map((s) => s.name);
      expect(names).toContain("mcp__fake__echo");
      const out = await ctx.require<ToolRegistry>("tools").execute(
        "mcp__fake__echo",
        { text: "host" },
        {
          workspaceRoot,
          signal: new AbortController().signal,
          channel: "host",
        },
      );
      expect(out).toBe("host");
      stop();
    } finally {
      if (prev === undefined) delete process.env.FAKE_TOKEN;
      else process.env.FAKE_TOKEN = prev;
    }
  });
```

说明：本片 **不** 把工作区 `.env` 自动填进 MCP `envValues`；上例靠 `process.env.FAKE_TOKEN` 满足声明 env。若实现误读 `.env` 进子进程也可工作，但 spec 不要求。

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run apps/host/tests/server.test.ts -t "mcp|ASSEMBLY does not include mcp|does not import"

Expected: FAIL（overlay 未写 / 包未装 / import 解析失败）。

- [ ] **Step 3: Minimal wiring**

根 `package.json` `devDependencies` 按字母序：

```json
    "@flintloom/mcp": "workspace:*",
```

运行 `pnpm install`（更新 lockfile，不要手改 lockfile）。

`apps/host/src/server.ts`：在 `loadConfig` 之后、`new Context()` 之前，对 `config.plugins` 中 `name === "@flintloom/mcp"` 的行：

```ts
  for (const row of config.plugins) {
    if (row.name === "@flintloom/mcp") {
      runtimeConfigById[row.id] = {
        ...runtimeConfigById[row.id],
        workspaceRoot,
      };
    }
  }
```

放在现有 `runtimeConfigById` 赋值块之后即可（与 telegram `pollChannels` overlay 同级思路）。

- [ ] **Step 4: Run full verification**

Run: `pnpm exec vitest run apps/host/tests/server.test.ts`

Expected: PASS。

Run: `pnpm test`

Expected: 全部 PASS。

Run: `pnpm typecheck`

Expected: exit 0。

- [ ] **Step 5: Commit**

```powershell
git add package.json pnpm-lock.yaml apps/host/src/server.ts apps/host/tests/server.test.ts
git commit -m @"
feat(host): overlay workspaceRoot for mcp plugins and add integration tests
"@
```

不要 `git add` `check_libs.py` 或 `scripts/desktop-dev.ts`。

---

## Spec coverage

| Spec | Task |
|---|---|
| `apply` 异步 + effect 回滚 | 1 |
| `applyConfig` 注入 `id` | 1 |
| Content-Length 成帧 | 2 |
| `initialize` / `tools/list` / `tools/call` | 2 |
| 假 stdio server 夹具 | 2 |
| env 基线 ∪ 声明、禁 `FLINTLOOM_*` | 3 |
| `validateMcpConfig` | 3 |
| 工具名 `mcp__<id>__<tool>`、非法名跳过 | 3 |
| async `apply` spawn + dispose 杀进程 | 3 |
| `createRuntime` overlay `workspaceRoot` | 4 |
| 默认 yml/ASSEMBLY 无 MCP | 4 |
| host 不 import 包 | 4 |
| `pnpm test` / `typecheck` | 4 |
| 无 HTTP / 桌面 / `runTurn` | 全任务未列入那些文件 |
