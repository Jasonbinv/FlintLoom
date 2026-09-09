# FlintLoom MCP 连通性测试按钮 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 插件页每台 MCP 增加「测试」：另起进程做 `initialize` + `tools/list`，卡片显示通过/失败；不调用工具、不写 YAML、不改已加载运行时。

**Architecture:** `@flintloom/mcp` 导出 `probeMcpServer`（spawn、握手、kill）。kernel 按声明查找、复用 `resolveMcpEnvValues`、经 `WORKSPACE_ROOT_OVERLAY_PACKAGES[0]` + `importFn` 调用。host 只加 `POST /v1/mcp-servers/:id/test` 并透传 JSON。桌面单独解析 `200 + { ok: false }`。

**Tech Stack:** 现有 TypeScript 包、Vitest、jsdom 桌面测试。不引入 `@modelcontextprotocol/sdk`。自动化不打网、不用 `npx`/`uvx`。

## Global Constraints

- Spec：`docs/superpowers/specs/2026-09-09-flintloom-mcp-probe-design.md`
- `apps/host/src` 不得出现 `@flintloom/mcp`、`createMcp`、`mcp__`（连 `import type` 也不要）。工具名只从 kernel 返回值透传。
- Probe 握手超时 **30s**；开机 `initialize` 默认仍 **8s**。
- 失败短词：`timeout` / `mcp` / `command` / `missing env: NAME`。不含密钥、env 值、绝对 `homeDir`。
- 握手失败 HTTP **200** `{ ok: false, error }`；400 仅 `id` / `command` / `args` / `env` / `enabled`。
- 不写 YAML、不 `reloadRuntime`、对话 busy 不挡测试。
- 成功文案后缀必须是「；对话仍用上次重载的进程」。
- Windows：PowerShell 用 `;` 不用 `&&`。指定文件 `git add`。用户未要求提交则跳过各 Task 的 commit 步。
- 不改 `frame.ts`、Chat、`ReasoningRow`；不给 `spawn` 加 `shell: true`。

## File map

```text
packages/mcp/src/errors.ts
packages/mcp/src/index.ts
packages/mcp/src/client.ts
packages/mcp/src/probe.ts
packages/mcp/src/tools.ts
packages/mcp/tests/probe.test.ts
packages/kernel/src/mcp-servers.ts
packages/kernel/src/mcp-probe.ts
packages/kernel/src/index.ts
packages/kernel/tests/mcp-probe.test.ts
apps/host/src/mcp-servers-http.ts
apps/host/src/server.ts
apps/host/tests/server.test.ts
apps/desktop/src/api.ts
apps/desktop/src/PluginsPane.tsx
apps/desktop/tests/App.test.tsx
docs/mcp-servers.md
```

---

### Task 1: `publicMcpError` 抽出；`initialize` 可选超时

**Files:**
- Create: `packages/mcp/src/errors.ts`
- Modify: `packages/mcp/src/index.ts`
- Modify: `packages/mcp/src/client.ts`
- Test: `packages/mcp/tests/client.test.ts`（现有仍绿即可；本 Task 不强制新超时用例）

**Interfaces:**
- Produces: `export function publicMcpError(err: unknown): string`
- Produces: `McpStdioClient.initialize(timeoutMs?: number): Promise<void>`，缺省 `MCP_INIT_TIMEOUT_MS`（8000）

- [ ] **Step 1: 把 `index.ts` 里的 `publicMcpError` 原样移到 `errors.ts` 并导出，`index.ts` 改为 import**

```ts
export function publicMcpError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("missing env:")) {
    return message.replace(/missing env:\s*/, "missing env: ").trim();
  }
  if (message.includes("timeout")) return "timeout";
  if (
    message === "id" ||
    message === "command" ||
    message === "args" ||
    message === "env" ||
    message === "workspaceRoot"
  ) {
    return message;
  }
  return "mcp";
}
```

- [ ] **Step 2: `initialize` 增加可选超时**

```ts
  async initialize(timeoutMs: number = MCP_INIT_TIMEOUT_MS): Promise<void> {
    await withTimeout(
      this.#request("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "flintloom", version: "0" },
      }),
      timeoutMs,
      "mcp initialize timeout",
    );
    this.#notify("notifications/initialized", {});
    const listResult = await withTimeout(
      this.#request("tools/list", {}),
      timeoutMs,
      "mcp tools/list timeout",
    );
    const tools = (listResult as { tools?: McpTool[] } | null)?.tools;
    this.#tools = Array.isArray(tools) ? tools : [];
  }
```

- [ ] **Step 3: 跑测试**

Run: `pnpm exec vitest run packages/mcp/tests/client.test.ts packages/mcp/tests/plugin.test.ts`

Expected: PASS。

- [ ] **Step 4: Commit**（用户未要求则跳过）

```
git add packages/mcp/src/errors.ts packages/mcp/src/index.ts packages/mcp/src/client.ts
git commit -m "refactor(mcp): share publicMcpError and optional initialize timeout"
```

---

### Task 2: `probeMcpServer`

**Files:**
- Create: `packages/mcp/src/probe.ts`
- Modify: `packages/mcp/src/index.ts`（导出）
- Modify: `packages/mcp/src/tools.ts`（导出名字过滤，避免 probe 复制正则）
- Test: `packages/mcp/tests/probe.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `initialize(timeoutMs)`、`publicMcpError`、`validateMcpConfig`、`buildChildEnv`、`McpStdioClient`
- Produces:

```ts
export const MCP_PROBE_TIMEOUT_MS = 30_000;

export type McpProbeResult =
  | { ok: true; tools: string[] }
  | { ok: false; error: string };

export async function probeMcpServer(
  config: Record<string, unknown>,
  timeoutMs?: number,
): Promise<McpProbeResult>;
```

- [ ] **Step 1: 在 `tools.ts` 导出登记名**

把文件顶部的 `MCP_TOOL_NAME_RE` 留下，追加：

```ts
export function registeredMcpToolNames(
  id: string,
  tools: readonly { name: string }[],
): string[] {
  return tools
    .filter((tool) => MCP_TOOL_NAME_RE.test(tool.name))
    .map((tool) => `mcp__${id}__${tool.name}`);
}
```

`registerMcpTools` 里用 `registeredMcpToolNames` 的过滤规则保持不变（仍按条 `register`）。

- [ ] **Step 2: 写失败测试 `packages/mcp/tests/probe.test.ts`**

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { probeMcpServer } from "../src/probe.ts";

const fixture = join(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/fake-mcp-server.mjs",
);

describe("probeMcpServer", () => {
  it("returns prefixed echo tool and does not throw", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-mcp-probe-"));
    const result = await probeMcpServer({
      id: "fake",
      command: process.execPath,
      args: [fixture],
      env: ["FAKE_TOKEN"],
      envValues: { FAKE_TOKEN: "tok" },
      workspaceRoot,
    });
    expect(result).toEqual({ ok: true, tools: ["mcp__fake__echo"] });
  });

  it("returns ok false for a missing command without throwing", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-mcp-probe-miss-"));
    const result = await probeMcpServer({
      id: "fake",
      command: join(workspaceRoot, "no-such-mcp-bin"),
      args: [],
      workspaceRoot,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toBe("mcp");
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm exec vitest run packages/mcp/tests/probe.test.ts`

Expected: FAIL，模块不存在。

- [ ] **Step 4: 实现 `probe.ts`**

```ts
import { McpStdioClient } from "./client.ts";
import { validateMcpConfig } from "./config.ts";
import { buildChildEnv } from "./env.ts";
import { publicMcpError } from "./errors.ts";
import { registeredMcpToolNames } from "./tools.ts";

export const MCP_PROBE_TIMEOUT_MS = 30_000;

export type McpProbeResult =
  | { ok: true; tools: string[] }
  | { ok: false; error: string };

export async function probeMcpServer(
  config: Record<string, unknown>,
  timeoutMs: number = MCP_PROBE_TIMEOUT_MS,
): Promise<McpProbeResult> {
  let client: McpStdioClient | undefined;
  try {
    const cfg = validateMcpConfig(config);
    const childEnv = buildChildEnv({
      declared: cfg.env,
      envValues: cfg.envValues,
    });
    client = new McpStdioClient({
      command: cfg.command,
      args: cfg.args,
      cwd: cfg.workspaceRoot,
      env: childEnv,
    });
    await client.initialize(timeoutMs);
    return {
      ok: true,
      tools: registeredMcpToolNames(cfg.id, client.listTools()),
    };
  } catch (err) {
    return { ok: false, error: publicMcpError(err) };
  } finally {
    client?.kill();
  }
}
```

`index.ts` 增加：`export { probeMcpServer, MCP_PROBE_TIMEOUT_MS, type McpProbeResult } from "./probe.ts";`

- [ ] **Step 5: 再跑**

Run: `pnpm exec vitest run packages/mcp/tests/probe.test.ts packages/mcp/tests/plugin.test.ts`

Expected: PASS。

- [ ] **Step 6: Commit**（可跳过）

```
git add packages/mcp/src/probe.ts packages/mcp/src/tools.ts packages/mcp/src/index.ts packages/mcp/tests/probe.test.ts
git commit -m "feat(mcp): probe stdio server handshake without registering tools"
```

---

### Task 3: kernel `probeMcpServer`

**Files:**
- Modify: `packages/kernel/src/mcp-servers.ts`（导出 `resolveMcpEnvValues`）
- Create: `packages/kernel/src/mcp-probe.ts`
- Modify: `packages/kernel/src/index.ts`
- Test: `packages/kernel/tests/mcp-probe.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `probeMcpServer`（经 `importFn`）
- Produces:

```ts
export async function probeMcpServer(input: {
  workspaceRoot: string;
  homeDir: string;
  id: string;
  command?: string;
  args?: string[];
  env?: string[];
  fileEnv: Record<string, string>;
  importFn?: ImportFn;
}): Promise<McpProbeResult>;
```

id 不在声明中 → `throw new Error("id")`。`enabled === false` → `throw new Error("enabled")`。`command` 传入空串 → `throw new Error("command")`。

- [ ] **Step 1: 导出 `resolveMcpEnvValues`**

`mcp-servers.ts` 把 `function resolveMcpEnvValues` 改成 `export function resolveMcpEnvValues`。签名保持：

```ts
export function resolveMcpEnvValues(
  env: string[] | undefined,
  fileEnv: Record<string, string>,
): Record<string, string> | undefined
```

- [ ] **Step 2: 写失败测试**

```ts
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { probeMcpServer } from "../src/mcp-probe.ts";

describe("kernel probeMcpServer", () => {
  it("throws id when the server is not declared", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-kprobe-miss-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-kprobe-miss-h-"));
    await expect(
      probeMcpServer({
        workspaceRoot,
        homeDir,
        id: "missing",
        fileEnv: {},
        importFn: async () => ({
          probeMcpServer: async () => ({ ok: true, tools: [] }),
        }),
      }),
    ).rejects.toThrow("id");
  });

  it("throws enabled when the declaration is disabled", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-kprobe-off-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-kprobe-off-h-"));
    writeFileSync(
      join(workspaceRoot, "mcp-servers.yml"),
      `servers:\n  - id: fake\n    command: node\n    enabled: false\n`,
    );
    await expect(
      probeMcpServer({
        workspaceRoot,
        homeDir,
        id: "fake",
        fileEnv: {},
        importFn: async () => ({
          probeMcpServer: async () => ({ ok: true, tools: [] }),
        }),
      }),
    ).rejects.toThrow("enabled");
  });

  it("passes draft command and dotenv envValues into importFn probe", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-kprobe-ok-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-kprobe-ok-h-"));
    writeFileSync(
      join(workspaceRoot, "mcp-servers.yml"),
      `servers:\n  - id: fake\n    command: node\n    args: [old.js]\n    env: [FAKE_TOKEN]\n`,
    );
    let seen: Record<string, unknown> | undefined;
    const result = await probeMcpServer({
      workspaceRoot,
      homeDir,
      id: "fake",
      command: "draft-node",
      args: ["new.js"],
      env: ["FAKE_TOKEN"],
      fileEnv: { FAKE_TOKEN: "from-file" },
      importFn: async () => ({
        probeMcpServer: async (config: Record<string, unknown>) => {
          seen = config;
          return { ok: true, tools: ["mcp__fake__echo"] };
        },
      }),
    });
    expect(result).toEqual({ ok: true, tools: ["mcp__fake__echo"] });
    expect(seen).toMatchObject({
      id: "fake",
      command: "draft-node",
      args: ["new.js"],
      env: ["FAKE_TOKEN"],
      envValues: { FAKE_TOKEN: "from-file" },
      workspaceRoot,
    });
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm exec vitest run packages/kernel/tests/mcp-probe.test.ts`

Expected: FAIL。

- [ ] **Step 4: 实现 `mcp-probe.ts`**

```ts
import { defaultImport, type ImportFn } from "./plugin-entry.ts";
import { WORKSPACE_ROOT_OVERLAY_PACKAGES } from "./plugin-overlay.ts";
import { listMcpServerDeclarations } from "./mcp-servers-write.ts";
import { resolveMcpEnvValues } from "./mcp-servers.ts";

export type McpProbeResult =
  | { ok: true; tools: string[] }
  | { ok: false; error: string };

type PackageProbe = (
  config: Record<string, unknown>,
  timeoutMs?: number,
) => Promise<McpProbeResult>;

function readPackageProbe(mod: unknown): PackageProbe {
  if (mod !== null && typeof mod === "object") {
    const fn = (mod as { probeMcpServer?: unknown }).probeMcpServer;
    if (typeof fn === "function") return fn as PackageProbe;
  }
  throw new Error("mcp");
}

export async function probeMcpServer(input: {
  workspaceRoot: string;
  homeDir: string;
  id: string;
  command?: string;
  args?: string[];
  env?: string[];
  fileEnv: Record<string, string>;
  importFn?: ImportFn;
}): Promise<McpProbeResult> {
  const listed = listMcpServerDeclarations({
    workspaceRoot: input.workspaceRoot,
    homeDir: input.homeDir,
  });
  const found = listed.find((row) => row.id === input.id);
  if (found === undefined) {
    throw new Error("id");
  }
  if (found.enabled === false) {
    throw new Error("enabled");
  }

  const useDraft = input.command !== undefined;
  if (useDraft && input.command.length === 0) {
    throw new Error("command");
  }

  const command = useDraft ? input.command : found.command;
  const args = useDraft ? (input.args ?? []) : (found.args ?? []);
  const env = useDraft ? (input.env ?? []) : (found.env ?? []);

  const config: Record<string, unknown> = {
    id: found.id,
    command,
    args,
    env,
    workspaceRoot: input.workspaceRoot,
  };
  const envValues = resolveMcpEnvValues(env, input.fileEnv);
  if (envValues !== undefined) {
    config.envValues = envValues;
  }

  const importFn = input.importFn ?? defaultImport;
  const mod = await importFn(WORKSPACE_ROOT_OVERLAY_PACKAGES[0]);
  const probe = readPackageProbe(mod);
  try {
    return await probe(config);
  } catch (err) {
    const message = err instanceof Error ? err.message : "mcp";
    if (message === "id" || message === "command" || message === "args" || message === "env") {
      throw err instanceof Error ? err : new Error(message);
    }
    return { ok: false, error: "mcp" };
  }
}
```

`index.ts` 增加从 `./mcp-probe.ts` 导出 `probeMcpServer` 与 `McpProbeResult`。

注意：kernel 用 `WORKSPACE_ROOT_OVERLAY_PACKAGES[0]`，host **不要** 复制这个字符串。

- [ ] **Step 5: 再跑**

Run: `pnpm exec vitest run packages/kernel/tests/mcp-probe.test.ts packages/kernel/tests/mcp-servers.test.ts`

Expected: PASS。

- [ ] **Step 6: Commit**（可跳过）

```
git add packages/kernel/src/mcp-probe.ts packages/kernel/src/mcp-servers.ts packages/kernel/src/index.ts packages/kernel/tests/mcp-probe.test.ts
git commit -m "feat(kernel): resolve MCP probe config from declarations and dotenv"
```

---

### Task 4: `POST /v1/mcp-servers/:id/test`

**Files:**
- Modify: `apps/host/src/mcp-servers-http.ts`
- Modify: `apps/host/src/server.ts`（`HandlerOpts` 增加 `fileEnv`，调用处传入 `readDotEnv(join(workspaceRoot, ".env"))`）
- Test: `apps/host/tests/server.test.ts`

**Interfaces:**
- Consumes: kernel `probeMcpServer`
- Produces: `POST /v1/mcp-servers/:id/test` → 200 `{ ok, tools? , error? }` 或 400

- [ ] **Step 1: 写失败测试**（插在现有 GET mcp-servers 用例附近）

断言 tools 时用模板，避免在 **src** 写 `mcp__`；**tests** 里可以写完整名。

```ts
  it("POST /v1/mcp-servers/:id/test probes the fixture without writing yaml", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-host-mcp-test-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-host-mcp-test-h-"));
    const fixture = fileURLToPath(
      new URL("../../../packages/mcp/fixtures/fake-mcp-server.mjs", import.meta.url),
    );
    const id = "fake";
    writeFileSync(
      join(workspaceRoot, "flintloom.yml"),
      `plugins:
  - id: models
    name: "@flintloom/models"
  - id: tools
    name: "@flintloom/tools"
`,
    );
    const yml = `servers:
  - id: ${id}
    command: ${JSON.stringify(process.execPath)}
    args: [${JSON.stringify(fixture)}]
    env: [FAKE_TOKEN]
`;
    writeFileSync(join(workspaceRoot, "mcp-servers.yml"), yml);
    writeFileSync(join(workspaceRoot, ".env"), "FAKE_TOKEN=from-dotenv\n", "utf8");
    const host = await startHost({ workspaceRoot, homeDir, port: 0 });
    close = host.close;
    const token = loadOrCreateToken(homeDir);
    const unauth = await fetch(`${host.url}/v1/mcp-servers/${id}/test`, { method: "POST" });
    expect(unauth.status).toBe(401);

    const res = await fetch(`${host.url}/v1/mcp-servers/${id}/test`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; tools?: string[] };
    expect(body.ok).toBe(true);
    expect(body.tools).toContain("mcp__fake__echo");
    expect(readFileSync(join(workspaceRoot, "mcp-servers.yml"), "utf8")).toBe(yml);

    const bad = await fetch(`${host.url}/v1/mcp-servers/${id}/test`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ command: join(workspaceRoot, "no-such-bin"), args: [], env: [] }),
    });
    expect(bad.status).toBe(200);
    const failed = (await bad.json()) as { ok: boolean; error?: string };
    expect(failed.ok).toBe(false);
    expect(failed.error).toBe("mcp");
    expect(readFileSync(join(workspaceRoot, "mcp-servers.yml"), "utf8")).toBe(yml);
  });

  it("POST /v1/mcp-servers/:id/test rejects disabled servers", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-host-mcp-testoff-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-host-mcp-testoff-h-"));
    writeFileSync(
      join(workspaceRoot, "flintloom.yml"),
      `plugins:
  - id: models
    name: "@flintloom/models"
  - id: tools
    name: "@flintloom/tools"
`,
    );
    writeFileSync(
      join(workspaceRoot, "mcp-servers.yml"),
      `servers:\n  - id: fake\n    command: node\n    enabled: false\n`,
    );
    const host = await startHost({ workspaceRoot, homeDir, port: 0 });
    close = host.close;
    const token = loadOrCreateToken(homeDir);
    const res = await fetch(`${host.url}/v1/mcp-servers/fake/test`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("enabled");
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run apps/host/tests/server.test.ts -t "POST /v1/mcp-servers/:id/test"`

Expected: FAIL（路由未处理，可能 404）。

- [ ] **Step 3: 实现路由（必须在 `itemId` 的 PUT 之前）**

`mcp-servers-http.ts`：

1. `HandlerOpts` 增加 `fileEnv: Record<string, string>`。
2. 增加：

```ts
function testId(pathname: string): string | undefined {
  const match = /^\/v1\/mcp-servers\/([^/]+)\/test$/.exec(pathname);
  return match?.[1];
}
```

3. 在 `copiedId` 分支旁边（`itemId` 之前）处理 POST test：

```ts
  const probedId = testId(opts.pathname);
  if (opts.method === "POST" && probedId !== undefined) {
    if (!isPluginId(probedId)) {
      send(res, 400, "id");
      return true;
    }
    let parsed: unknown = {};
    const raw = await readBody(req);
    if (raw.trim().length > 0) {
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        send(res, 400);
        return true;
      }
    }
    if (parsed !== undefined && parsed !== null && !isPlainObject(parsed)) {
      send(res, 400);
      return true;
    }
    const body = isPlainObject(parsed) ? parsed : {};
    const draftCommand =
      "command" in body
        ? typeof body.command === "string"
          ? body.command
          : undefined
        : undefined;
    if ("command" in body && draftCommand === undefined) {
      send(res, 400, "command");
      return true;
    }
    let args: string[] | undefined;
    let env: string[] | undefined;
    if (draftCommand !== undefined) {
      const argsField = readStringArrayField(body.args, "args");
      if (!argsField.ok) {
        send(res, 400, "args");
        return true;
      }
      args = argsField.value ?? [];
      const envField = readStringArrayField(body.env, "env");
      if (!envField.ok) {
        send(res, 400, "env");
        return true;
      }
      env = envField.value ?? [];
    }
    try {
      const result = await probeMcpServer({
        workspaceRoot: opts.workspaceRoot,
        homeDir: opts.homeDir,
        id: probedId,
        command: draftCommand,
        args,
        env,
        fileEnv: opts.fileEnv,
      });
      sendJson(res, 200, result);
    } catch (err) {
      if (sendKnownError(res, err)) {
        return true;
      }
      throw err;
    }
    return true;
  }
```

**禁止**在 host src 里拼接工具名前缀或写 `@flintloom/mcp`。`sendJson(res, 200, result)` 即可。

`readStringArrayField`：若字段缺省，现有实现应返回 `{ ok: true, value: undefined }`。确认后 `?? []`。

`server.ts` 调用处增加 `fileEnv: readDotEnv(join(workspaceRoot, ".env"))`。

`sendKnownError` 已含 `"enabled"`，不必再加。

- [ ] **Step 4: 再跑**

Run: `pnpm exec vitest run apps/host/tests/server.test.ts -t "mcp-servers"`

Expected: 新用例 PASS；`host src does not import tool factories` 仍绿。

- [ ] **Step 5: Commit**（可跳过）

```
git add apps/host/src/mcp-servers-http.ts apps/host/src/server.ts apps/host/tests/server.test.ts
git commit -m "feat(host): add MCP server connectivity test endpoint"
```

---

### Task 5: 插件页「测试」按钮

**Files:**
- Modify: `apps/desktop/src/api.ts`
- Modify: `apps/desktop/src/PluginsPane.tsx`
- Test: `apps/desktop/tests/App.test.tsx`

**Interfaces:**
- Consumes: `POST /v1/mcp-servers/:id/test`
- Produces: `testMcpServer(id, draft?)`；按钮文案 **测试** / **测试中…**

- [ ] **Step 1: 写失败测试**

在 `shows plugin list on Plugins page` 同文件追加（沿用 `installFetch` / `mountApp` / `act` / `requestUrl`）。先 `installFetch`，再包一层 fetch：`/test` 走探针响应，其余调用保存的 fallback。

```ts
  it("tests an MCP server from the plugins page without changing loaded tools", async () => {
    const servers = {
      servers: [
        {
          id: "fake",
          command: "node",
          args: ["packages/mcp/fixtures/fake-mcp-server.mjs"],
          env: ["FAKE_TOKEN"],
          enabled: true,
          source: "workspace" as const,
          writable: true,
          status: "loaded" as const,
          tools: ["mcp__fake__echo"],
          error: null,
        },
      ],
    };
    installFetch({
      plugins: new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
      mcpServers: new Response(JSON.stringify(servers), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    });
    const fallback = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = requestUrl(input);
      if (url.includes("/v1/mcp-servers/fake/test") && (init?.method ?? "GET") === "POST") {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          command: "node",
          args: ["packages/mcp/fixtures/fake-mcp-server.mjs"],
          env: ["FAKE_TOKEN"],
        });
        return new Response(
          JSON.stringify({ ok: true, tools: ["mcp__fake__echo"] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return fallback(input, init);
    }) as typeof fetch;
    await mountApp();
    const pluginsTab = findNavTab("插件");
    await act(async () => {
      pluginsTab!.click();
    });
    await waitForText("fake");
    const testBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "测试",
    );
    expect(testBtn).toBeTruthy();
    await act(async () => {
      (testBtn as HTMLButtonElement).click();
    });
    await waitForText("测试通过");
    expect(document.body.textContent).toContain("mcp__fake__echo");
    expect(document.body.textContent).toContain("对话仍用上次重载的进程");
    expect(document.querySelector(".status-pill")?.textContent).toBe("已加载");
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run apps/desktop/tests/App.test.tsx -t "tests an MCP server"`

Expected: FAIL，无「测试」按钮。

- [ ] **Step 3: `api.ts` 增加（不要用 `throwIfMcpMutationFailed`）**

```ts
export type McpProbeResult =
  | { ok: true; tools: string[] }
  | { ok: false; error: string };

export async function testMcpServer(
  id: string,
  draft?: { command: string; args: string[]; env: string[] },
): Promise<McpProbeResult> {
  const res = await fetch(`/v1/mcp-servers/${encodeURIComponent(id)}/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(draft ?? {}),
  });
  if (res.status === 401 || res.status === 0) {
    throw new Error("host unreachable");
  }
  if (res.status === 400) {
    const text = (await res.text()).trim();
    throw new Error(text.length > 0 ? text : "invalid");
  }
  if (!res.ok) throw new Error("mcp failed");
  return (await res.json()) as McpProbeResult;
}
```

- [ ] **Step 4: `PluginsPane.tsx`**

1. `mcpWriteError` 增加：`if (err.message === "enabled") return "请先启用";`
2. state：`testingId: string | undefined`、`probeMessage: Record<string, string>`（按 server id）。
3. `onTest(server)`：
   - 可写：`parseArgs(draft.args)`，失败则 `setProbeMessage` 为「args 无效」；`env = parseEnv(draft.env)`；`await testMcpServer(server.id, { command: draft.command, args, env })`。
   - 只读：`await testMcpServer(server.id)`。
   - 成功：`测试通过` +（tools 非空则 ` ` + join）+ `；对话仍用上次重载的进程`。
   - `ok: false`：`测试失败：${error}`。
   - throw：`mcpWriteError`。
   - `finally` 清 `testingId`。
4. 按钮放在「保存」旁（只读放在「复制到工作区」旁），文案 `testingId === server.id ? "测试中…" : "测试"`。`disabled={saving || testingId === server.id || !server.enabled}`。
5. 提示：`{probeMessage[server.id] ? <p className="settings-card-hint">{probeMessage[server.id]}</p> : null}` 放在错误行附近，不要改 status pill。

- [ ] **Step 5: 再跑**

Run: `pnpm exec vitest run apps/desktop/tests/App.test.tsx -t "plugin"`

Expected: 新用例与 `shows plugin list on Plugins page` PASS。

- [ ] **Step 6: Commit**（可跳过）

```
git add apps/desktop/src/api.ts apps/desktop/src/PluginsPane.tsx apps/desktop/tests/App.test.tsx
git commit -m "feat(desktop): add MCP connectivity test button"
```

---

### Task 6: `docs/mcp-servers.md` 一句说明

**Files:**
- Modify: `docs/mcp-servers.md`

**Interfaces:** 无代码。

- [ ] **Step 1: 在「在插件页管理」第二节后追加**

```markdown
每张 MCP 卡片上的「测试」会另起进程做 initialize / tools/list，不调用工具、不写配置。测试通过不等于对话已换新进程，需要的话再点「重载 host」。
```

- [ ] **Step 2: Commit**（可跳过）

```
git add docs/mcp-servers.md
git commit -m "docs: note MCP connectivity test on the plugins page"
```

---

## Self-review

| Spec 要求 | Task |
|---|---|
| probe spawn + initialize + kill | 2 |
| 30s 仅 probe / 开机 8s | 1, 2 |
| publicMcpError 共用 | 1 |
| resolveMcpEnvValues 复用 | 3 |
| host 不出现 `@flintloom/mcp` / `mcp__` | 4 |
| POST test、200 ok:false、400 enabled | 4 |
| 草稿 parseArgs/parseEnv | 5 |
| 文案后缀与不改徽章 | 5 |
| 文档 | 6 |
| 不调工具 / 不 shell:true | 全局 |

无 TBD。类型名 `probeMcpServer` / `McpProbeResult` / `MCP_PROBE_TIMEOUT_MS` 前后一致。
