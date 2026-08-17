# FlintLoom 1.5：插件组装 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 开机从 `flintloom.yml` 真正 `import` 并 `apply(ctx)`：工具、模型、session、loop 都是可逆插件；host/CLI 不再手工 `register`；`flint` 仍能跑完一轮对话。

**Architecture:** Kernel 增加 `require` / `effect` / `hook` / `waterfall` 与 `applyConfig`。yml 从上到下即依赖顺序。`tools/pre-execute` 包住工具执行；确定性 `resolveInside` 永远在 waterfall 之前。`guard` 是 tools 插件登记的第一条监听。host 只负责读 yml、把凭证 overlay 进 `models-chat` 的 config、HTTP。

**Tech Stack:** 现有 Node 22+、TypeScript、pnpm workspaces、Vitest、`yaml`。动态 `import(name)` 解析 workspace 包。不引入 Cordis / deepseek-harness。

## Global Constraints

- 产品名 FlintLoom；包名前缀 `@flintloom/*`；CLI `flint`。
- 不 import、不 submodule、不拷贝 dataagent-v3 / deepseek-harness / Cordis。
- 每个 Loom 包 default export `{ name, apply(ctx, config) }`。`config` 为 `{ ...row.config, ...runtimeConfigById[id] }`，缺省 `{}`。
- API key 只从进程环境变量 / 工作区 `.env` / `~/.flintloom/credentials` 进 overlay，不写进 yml，不进 session log。
- 工作区没有或损坏 `flintloom.yml`、插件加载失败、`id` 重复、`require` 缺失 → 拒绝启动。
- 未配置 `chat` → 允许启动；turn 失败并写 `model/error`。
- `apps/host/src` 禁止 import `@flintloom/fs`、`@flintloom/grep`、`@flintloom/shell`、`@flintloom/models-chat`，以及 `createDocProbeTool` / `createDocParseTool`。预览可 import DocForge 纯函数。
- 不实现 `flint plugin add`、MCP、skill、通道、知识库、A2UI、`tools/post-execute`、inject、isolate、HMR。
- 契约见 `docs/superpowers/specs/2026-08-17-flintloom-plugin-composition-design.md`。

## File map

```text
packages/kernel/src/context.ts          # require, effect, hook, waterfall；plugin(config)
packages/kernel/src/apply-config.ts     # applyConfig + unwrapPlugin
packages/kernel/src/index.ts
packages/kernel/tests/context.test.ts
packages/kernel/tests/apply-config.test.ts
packages/models/src/plugin.ts           # default apply → provide("models")
packages/models/src/index.ts
packages/models/tests/plugin.test.ts
packages/session/src/store.ts           # SessionStore get / getOrCreate
packages/session/src/plugin.ts
packages/session/src/index.ts
packages/session/tests/store.test.ts
packages/tools/src/registry.ts          # ToolRegistry(ctx)；execute 走 waterfall
packages/tools/src/plugin.ts            # provide tools + guard 监听
packages/tools/src/types.ts             # ToolPreExecutePayload
packages/tools/src/index.ts
packages/tools/tests/registry.test.ts
packages/fs/src/plugin.ts
packages/grep/src/plugin.ts
packages/shell/src/plugin.ts
packages/models-chat/src/plugin.ts
packages/docforge/src/plugin.ts
packages/loop/src/run-turn.ts           # RunTurnInput.ctx；require models/tools
packages/loop/src/plugin.ts
packages/loop/tests/run-turn.test.ts
apps/host/src/server.ts                 # async createRuntime → applyConfig
apps/host/tests/server.test.ts
apps/host/tests/files.test.ts           # 每个临时工作区写 yml
apps/cli/src/bin.ts
flintloom.yml
```

默认 yml 顺序：`models` → `tools` → `session` → `models-chat` → `fs` → `grep` → `shell` → `docforge` → `loop`。

---

### Task 1: Context.require / effect / hook / waterfall

**Files:**
- Modify: `packages/kernel/src/context.ts`
- Modify: `packages/kernel/tests/context.test.ts`

**Interfaces:**
- Consumes: 现有 `Context.provide` / `get` / `plugin`
- Produces:
  - `FlintPlugin.apply(ctx: Context, config: Record<string, unknown>): void`
  - `ctx.require<T>(key: string): T` — 缺失则 `throw new Error(key)`
  - `ctx.effect(dispose: Disposer): Disposer`
  - `ctx.hook(event: string, handler: WaterfallHandler): Disposer`
  - `ctx.waterfall<P, R>(event: string, payload: P, terminal: () => Promise<R>): Promise<R>`
  - `ctx.plugin(plugin, config = {}): Disposer`
  - `export type WaterfallHandler = (payload: unknown, next: () => Promise<unknown>) => unknown | Promise<unknown>`

- [ ] **Step 1: Write the failing test**

在 `context.test.ts` 追加：

```ts
it("require 缺失则抛错且消息含键名", () => {
  const ctx = new Context();
  expect(() => ctx.require("models")).toThrow(/models/);
});

it("effect 在 plugin dispose 时按反序调用", () => {
  const ctx = new Context();
  const log: string[] = [];
  const stop = ctx.plugin({
    name: "fx",
    apply(c) {
      c.effect(() => {
        log.push("a");
      });
      c.effect(() => {
        log.push("b");
      });
    },
  });
  stop();
  expect(log).toEqual(["b", "a"]);
});

it("waterfall 先登记的监听在外层；不调用 next 则短路", async () => {
  const ctx = new Context();
  const log: string[] = [];
  ctx.hook("t", async (_payload, next) => {
    log.push("outer");
    return "short";
  });
  ctx.hook("t", async (_payload, next) => {
    log.push("inner");
    return next();
  });
  const result = await ctx.waterfall("t", {}, async () => {
    log.push("term");
    return "done";
  });
  expect(result).toBe("short");
  expect(log).toEqual(["outer"]);
});

it("waterfall 全部 next 则执行 terminal", async () => {
  const ctx = new Context();
  const log: string[] = [];
  ctx.hook("t", async (_payload, next) => {
    log.push("a");
    return next();
  });
  const result = await ctx.waterfall("t", {}, async () => {
    log.push("term");
    return "done";
  });
  expect(result).toBe("done");
  expect(log).toEqual(["a", "term"]);
});

it("plugin dispose 后 hook 不再触发", async () => {
  const ctx = new Context();
  const stop = ctx.plugin({
    name: "h",
    apply(c) {
      c.hook("t", async (_payload, next) => "from-plugin");
    },
  });
  stop();
  const result = await ctx.waterfall("t", {}, async () => "term");
  expect(result).toBe("term");
});
```

把现有 `apply(c)` 单测改为仍合法：`apply(c, _config)` 可忽略第二参。`plugin()` 不传 config 时默认 `{}`。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/kernel/tests/context.test.ts`

Expected: FAIL（`require` / `effect` / `hook` 未定义）

- [ ] **Step 3: Write minimal implementation**

替换 `packages/kernel/src/context.ts` 为：

```ts
export type Disposer = () => void;

export type WaterfallHandler = (
  payload: unknown,
  next: () => Promise<unknown>,
) => unknown | Promise<unknown>;

export interface FlintPlugin {
  name: string;
  apply(ctx: Context, config: Record<string, unknown>): void;
}

export class Context {
  #values = new Map<string, unknown>();
  #disposers: Disposer[] = [];
  #hooks = new Map<string, WaterfallHandler[]>();

  provide(key: string, value: unknown): Disposer {
    this.#values.set(key, value);
    const dispose = () => {
      this.#values.delete(key);
    };
    this.#disposers.push(dispose);
    return dispose;
  }

  get<T>(key: string): T | undefined {
    return this.#values.get(key) as T | undefined;
  }

  require<T>(key: string): T {
    if (!this.#values.has(key)) {
      throw new Error(key);
    }
    return this.#values.get(key) as T;
  }

  effect(dispose: Disposer): Disposer {
    this.#disposers.push(dispose);
    return dispose;
  }

  hook(event: string, handler: WaterfallHandler): Disposer {
    const list = this.#hooks.get(event) ?? [];
    list.push(handler);
    this.#hooks.set(event, list);
    const dispose = () => {
      const current = this.#hooks.get(event);
      if (current === undefined) {
        return;
      }
      this.#hooks.set(
        event,
        current.filter((h) => h !== handler),
      );
    };
    this.#disposers.push(dispose);
    return dispose;
  }

  async waterfall<P, R>(
    event: string,
    payload: P,
    terminal: () => Promise<R>,
  ): Promise<R> {
    const handlers = [...(this.#hooks.get(event) ?? [])];
    let index = 0;
    const next = async (): Promise<unknown> => {
      const handler = handlers[index];
      index += 1;
      if (handler === undefined) {
        return terminal();
      }
      return handler(payload, next);
    };
    return (await next()) as R;
  }

  plugin(
    plugin: FlintPlugin,
    config: Record<string, unknown> = {},
  ): Disposer {
    const before = this.#disposers.length;
    plugin.apply(this, config);
    const mine = this.#disposers.slice(before);
    return () => {
      for (const d of mine.reverse()) d();
    };
  }
}
```

现有单测 `apply(c) { c.provide(...) }` 在 TS 下第二参可省略吗？接口要求两参。把旧单测 `apply` 改成 `apply(c) {` 会与新接口冲突。旧测试改为：

```ts
apply(c) {
  c.provide("probe.n", 7);
},
```

实现侧 `apply(ctx, config)` 两参；测试里 `apply(c)` 只写一参在 TS 函数字面量上是合法的（参数更少可赋给参数更多？不——FlintPlugin 要求两参，测试对象字面量的 apply 必须接受 `(ctx, config)`。写成 `apply(c, _config)` 或 `apply(c)` 在 TS strictFunctionTypes 下对象字面量检查：源函数参数少通常可以。为避免摩擦，旧测试用 `apply(c, _config)`。

`index.ts` 增加导出 `WaterfallHandler`。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/kernel/tests/context.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/context.ts packages/kernel/src/index.ts packages/kernel/tests/context.test.ts
git commit -m "feat: add ctx.require, effect, and tools waterfall hooks"
```

---

### Task 2: applyConfig

**Files:**
- Create: `packages/kernel/src/apply-config.ts`
- Create: `packages/kernel/tests/apply-config.test.ts`
- Modify: `packages/kernel/src/index.ts`

**Interfaces:**
- Consumes: `Context.plugin`、`loadConfig` 的 `FlintloomConfig`
- Produces:
```ts
export type ImportFn = (name: string) => Promise<unknown>;

export async function applyConfig(
  ctx: Context,
  config: FlintloomConfig,
  opts?: {
    importFn?: ImportFn;
    runtimeConfigById?: Record<string, Record<string, unknown>>;
  },
): Promise<Disposer>
```

Unwrap：`mod.default` 有 `apply` 则用它，否则模块自身有 `apply`。都没有 → `throw new Error(row.name)`（消息也允许含 `id`）。重复 `id` → `throw new Error("id")`。某行失败：对已成功行调用 stop，再抛错。

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { applyConfig, Context, type FlintPlugin } from "../src/index.ts";

function plugin(name: string, apply: FlintPlugin["apply"]): FlintPlugin {
  return { name, apply };
}

describe("applyConfig", () => {
  it("按行 apply 并合并 runtime config", async () => {
    const seen: Record<string, unknown>[] = [];
    const ctx = new Context();
    const mods: Record<string, FlintPlugin> = {
      a: plugin("a", (c, config) => {
        seen.push(config);
        c.provide("a", true);
      }),
      b: plugin("b", (c) => {
        c.require("a");
        c.provide("b", true);
      }),
    };

    const stop = await applyConfig(
      ctx,
      {
        plugins: [
          { id: "a", name: "pkg-a", config: { fromYml: 1 } },
          { id: "b", name: "pkg-b" },
        ],
      },
      {
        importFn: async (name) => (name === "pkg-a" ? mods.a : mods.b),
        runtimeConfigById: { a: { apiKey: "k" } },
      },
    );

    expect(ctx.require("b")).toBe(true);
    expect(seen[0]).toEqual({ fromYml: 1, apiKey: "k" });
    stop();
    expect(() => ctx.require("a")).toThrow(/a/);
  });

  it("重复 id 拒绝启动", async () => {
    const ctx = new Context();
    await expect(
      applyConfig(ctx, {
        plugins: [
          { id: "a", name: "x" },
          { id: "a", name: "y" },
        ],
      }, { importFn: async () => plugin("x", () => {}) }),
    ).rejects.toThrow(/id/);
  });

  it("没有 apply 则抛 name", async () => {
    const ctx = new Context();
    await expect(
      applyConfig(
        ctx,
        { plugins: [{ id: "a", name: "bad-pkg" }] },
        { importFn: async () => ({}) },
      ),
    ).rejects.toThrow(/bad-pkg/);
  });

  it("第二行失败则撤销第一行", async () => {
    const ctx = new Context();
    await expect(
      applyConfig(
        ctx,
        {
          plugins: [
            { id: "a", name: "pkg-a" },
            { id: "b", name: "pkg-b" },
          ],
        },
        {
          importFn: async (name) =>
            name === "pkg-a"
              ? plugin("a", (c) => {
                  c.provide("a", 1);
                })
              : plugin("b", () => {
                  throw new Error("boom");
                }),
        },
      ),
    ).rejects.toThrow(/boom/);
    expect(() => ctx.require("a")).toThrow(/a/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/kernel/tests/apply-config.test.ts`

Expected: FAIL（`applyConfig` 未导出）

- [ ] **Step 3: Write minimal implementation**

`apply-config.ts`：

```ts
import type { FlintloomConfig } from "./config.ts";
import type { Context, Disposer, FlintPlugin } from "./context.ts";

export type ImportFn = (name: string) => Promise<unknown>;

function isApplyFn(value: unknown): value is FlintPlugin["apply"] {
  return typeof value === "function";
}

export function unwrapPlugin(mod: unknown, name: string): FlintPlugin {
  if (mod !== null && typeof mod === "object") {
    const rec = mod as Record<string, unknown>;
    const def = rec.default;
    if (def !== null && typeof def === "object") {
      const apply = (def as { apply?: unknown }).apply;
      const pluginName = (def as { name?: unknown }).name;
      if (isApplyFn(apply)) {
        return {
          name: typeof pluginName === "string" ? pluginName : name,
          apply,
        };
      }
    }
    if (isApplyFn((mod as { apply?: unknown }).apply)) {
      return mod as FlintPlugin;
    }
  }
  throw new Error(name);
}

export async function applyConfig(
  ctx: Context,
  config: FlintloomConfig,
  opts?: {
    importFn?: ImportFn;
    runtimeConfigById?: Record<string, Record<string, unknown>>;
  },
): Promise<Disposer> {
  const importFn = opts?.importFn ?? ((n: string) => import(n));
  const runtime = opts?.runtimeConfigById ?? {};
  const seen = new Set<string>();
  const stops: Disposer[] = [];

  const rollback = (): void => {
    for (const stop of stops.reverse()) stop();
  };

  try {
    for (const row of config.plugins) {
      if (seen.has(row.id)) {
        throw new Error("id");
      }
      seen.add(row.id);
      const mod = await importFn(row.name);
      const plugin = unwrapPlugin(mod, row.name);
      const merged = { ...(row.config ?? {}), ...(runtime[row.id] ?? {}) };
      stops.push(ctx.plugin(plugin, merged));
    }
  } catch (err) {
    rollback();
    throw err;
  }

  return () => {
    rollback();
  };
}
```

`index.ts` 导出 `applyConfig`、`unwrapPlugin`、`ImportFn`。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/kernel/tests/apply-config.test.ts packages/kernel/tests/context.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/src/apply-config.ts packages/kernel/src/index.ts packages/kernel/tests/apply-config.test.ts
git commit -m "feat: load flintloom.yml plugins via applyConfig"
```

---

### Task 3: models 与 session 插件

**Files:**
- Create: `packages/models/src/plugin.ts`
- Create: `packages/models/tests/plugin.test.ts`
- Modify: `packages/models/src/index.ts`
- Create: `packages/session/src/store.ts`
- Create: `packages/session/src/plugin.ts`
- Create: `packages/session/tests/store.test.ts`
- Modify: `packages/session/src/index.ts`

**Interfaces:**
- Consumes: `Context.provide` / `require`
- Produces:
  - `models` default export：`apply` → `ctx.provide("models", new ModelRegistry())`
  - `SessionStore`：`get(id: string): Session | undefined`；`getOrCreate(id: string): Session`
  - `session` default export：`apply` → `ctx.provide("sessions", new SessionStore())`

- [ ] **Step 1: Write the failing tests**

`packages/models/tests/plugin.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { Context } from "@flintloom/kernel";
import plugin, { ModelRegistry } from "../src/index.ts";

describe("models plugin", () => {
  it("provide models 注册表", () => {
    const ctx = new Context();
    ctx.plugin(plugin);
    expect(ctx.require("models")).toBeInstanceOf(ModelRegistry);
  });
});
```

`packages/session/tests/store.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { Context } from "@flintloom/kernel";
import plugin, { SessionStore } from "../src/index.ts";

describe("session plugin", () => {
  it("getOrCreate 同一 id 返回同一 Session", () => {
    const ctx = new Context();
    ctx.plugin(plugin);
    const store = ctx.require<SessionStore>("sessions");
    const a = store.getOrCreate("s1");
    const b = store.getOrCreate("s1");
    expect(a).toBe(b);
    expect(store.get("missing")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/models/tests/plugin.test.ts packages/session/tests/store.test.ts`

Expected: FAIL（无 default export / 无 SessionStore）

- [ ] **Step 3: Write minimal implementation**

`packages/models/src/plugin.ts`：

```ts
import type { Context, FlintPlugin } from "@flintloom/kernel";
import { ModelRegistry } from "./registry.ts";

const plugin: FlintPlugin = {
  name: "@flintloom/models",
  apply(ctx: Context) {
    ctx.provide("models", new ModelRegistry());
  },
};

export default plugin;
```

`packages/session/src/store.ts`：

```ts
import { Session } from "./session.ts";

export class SessionStore {
  readonly #map = new Map<string, Session>();

  get(id: string): Session | undefined {
    return this.#map.get(id);
  }

  getOrCreate(id: string): Session {
    const existing = this.#map.get(id);
    if (existing !== undefined) {
      return existing;
    }
    const created = new Session(id);
    this.#map.set(id, created);
    return created;
  }
}
```

`packages/session/src/plugin.ts`：同 models 模式，`provide("sessions", new SessionStore())`。

`index.ts`：`export { default } from "./plugin.ts"` 以及 named exports 保持不变（models 已有大量 named export，改为在 `index.ts` 末尾 `export { default } from "./plugin.ts"`）。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/models packages/session`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/models packages/session
git commit -m "feat: provide models and sessions from plugins"
```

---

### Task 4: tools 插件与 `tools/pre-execute`

**Files:**
- Modify: `packages/tools/src/types.ts`
- Modify: `packages/tools/src/registry.ts`
- Create: `packages/tools/src/plugin.ts`
- Modify: `packages/tools/src/index.ts`
- Modify: `packages/tools/tests/registry.test.ts`
- Modify: `packages/loop/src/run-turn.ts`（`execute` 不再传 `models`）
- Modify: `packages/loop/tests/run-turn.test.ts`（`new ToolRegistry(ctx)`）
- Modify: `apps/host/src/server.ts`（`new ToolRegistry(ctx)`，仍手工 register；见本任务 Step 3 的过渡形态）

**Interfaces:**
- Consumes: `Context.waterfall` / `hook` / `require("models")`
- Produces:
  - `export const TOOLS_PRE_EXECUTE = "tools/pre-execute"`
  - `ToolPreExecutePayload = { tool, args, workspaceRoot, channel, signal }`
  - `new ToolRegistry(ctx: Context)`
  - `execute(name, args, exec): Promise<string>` — 无 `models` 参数
  - tools default export：`provide("tools", registry)` + 第一条 pre-execute 监听（guard）

- [ ] **Step 1: Write the failing test**

替换 `registry.test.ts` 为：

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Context } from "@flintloom/kernel";
import { ModelRegistry, type GuardProvider } from "@flintloom/models";
import modelsPlugin from "@flintloom/models";
import plugin, { ToolRegistry, WorkspaceEscapeError } from "../src/index.ts";

describe("tools plugin", () => {
  it("does not call the tool when guard denies", async () => {
    const ctx = new Context();
    ctx.plugin(modelsPlugin);
    ctx.plugin(plugin);
    const tools = ctx.require<ToolRegistry>("tools");
    let callCount = 0;
    tools.register({
      name: "touch",
      description: "touch file",
      parameters: {},
      async execute() {
        callCount += 1;
        return "touched";
      },
    });

    const models = ctx.require<ModelRegistry>("models");
    const guard: GuardProvider = {
      async gate() {
        return "deny";
      },
    };
    models.registerGuard("default-guard", guard);
    models.setDefault("guard", "default-guard");

    const result = await tools.execute(
      "touch",
      {},
      {
        workspaceRoot: process.cwd(),
        signal: new AbortController().signal,
        channel: "test",
      },
    );

    expect(callCount).toBe(0);
    expect(result).toBe("guard denied: touch");
  });

  it("throws WorkspaceEscapeError before waterfall", async () => {
    const ctx = new Context();
    ctx.plugin(modelsPlugin);
    ctx.plugin(plugin);
    const tools = ctx.require<ToolRegistry>("tools");
    let ran = false;
    ctx.hook("tools/pre-execute", async () => {
      ran = true;
      return "should-not";
    });
    tools.register({
      name: "touch",
      description: "t",
      parameters: {},
      async execute() {
        return "ok";
      },
    });
    const root = mkdtempSync(join(tmpdir(), "flintloom-tools-ws-"));
    await expect(
      tools.execute(
        "touch",
        { path: "../outside" },
        {
          workspaceRoot: root,
          signal: new AbortController().signal,
          channel: "test",
        },
      ),
    ).rejects.toBeInstanceOf(WorkspaceEscapeError);
    expect(ran).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/tools/tests/registry.test.ts`

Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

`types.ts` 增加：

```ts
export const TOOLS_PRE_EXECUTE = "tools/pre-execute";

export type ToolPreExecutePayload = {
  tool: string;
  args: Record<string, unknown>;
  workspaceRoot: string;
  channel: string;
  signal: AbortSignal;
};
```

`registry.ts`：`constructor(private readonly ctx: Context)`。`execute` 去掉 `models` 参数。在 `resolveInside` 之后：

```ts
return this.ctx.waterfall(
  TOOLS_PRE_EXECUTE,
  {
    tool: name,
    args,
    workspaceRoot: exec.workspaceRoot,
    channel: exec.channel,
    signal: exec.signal,
  },
  () => def.execute(args, exec),
);
```

删除 registry 内的 `resolveGuard` 分支。

`plugin.ts`：

```ts
import type { Context, FlintPlugin } from "@flintloom/kernel";
import type { ModelRegistry } from "@flintloom/models";
import { ToolRegistry } from "./registry.ts";
import { TOOLS_PRE_EXECUTE, type ToolPreExecutePayload } from "./types.ts";

const plugin: FlintPlugin = {
  name: "@flintloom/tools",
  apply(ctx: Context) {
    const registry = new ToolRegistry(ctx);
    ctx.provide("tools", registry);
    ctx.hook(TOOLS_PRE_EXECUTE, async (payload, next) => {
      const p = payload as ToolPreExecutePayload;
      const models = ctx.require<ModelRegistry>("models");
      const guard = models.resolveGuard();
      if (guard === undefined) {
        return next();
      }
      const decision = await guard.gate(
        {
          tool: p.tool,
          args: p.args,
          workspaceRoot: p.workspaceRoot,
          channel: p.channel,
        },
        p.signal,
      );
      if (decision === "deny") {
        return `guard denied: ${p.tool}`;
      }
      if (decision === "ask") {
        return `guard denied: ${p.tool} (ask not supported in slice 1)`;
      }
      return next();
    });
  },
};

export default plugin;
```

`run-turn.ts`：`tools.execute(name, args, exec)` 只传三参（仍从 input 解构 `models` 给 `resolveChat`）。

`run-turn.test.ts`：每个用例 `const ctx = new Context(); const tools = new ToolRegistry(ctx);`。

`server.ts` 过渡（本任务必须让 `pnpm test` 绿）：

```ts
const ctx = new Context();
const models = new ModelRegistry();
const tools = new ToolRegistry(ctx);
```

其余手工 `register` / `registerChat` 暂留。`Runtime` 仍含 `models`/`tools`/`sessions`。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/tools packages/loop apps/host`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/tools packages/loop apps/host/src/server.ts
git commit -m "feat: run tools through pre-execute waterfall"
```

---

### Task 5: fs / grep / shell / models-chat / docforge 的 apply

**Files:**
- Create: `packages/fs/src/plugin.ts`；Modify: `packages/fs/src/index.ts`、`packages/fs/package.json`（加 `@flintloom/kernel`）
- Create: `packages/grep/src/plugin.ts`；Modify: `packages/grep/src/index.ts`、`package.json`
- Create: `packages/shell/src/plugin.ts`；Modify: `packages/shell/src/index.ts`、`package.json`
- Create: `packages/models-chat/src/plugin.ts`；Modify: `packages/models-chat/src/index.ts`、`package.json`（加 kernel + 已有 models）
- Create: `packages/docforge/src/plugin.ts`；Modify: `packages/docforge/src/index.ts`、`package.json`（加 kernel）
- Create: `packages/tools/tests/apply-tools.test.ts`（或 `packages/kernel/tests` 外的集成测试：`packages/fs/tests/plugin.test.ts` 等五个小文件也可；本任务用一份 `packages/kernel/tests/builtin-plugins.test.ts` 会反向依赖 fs，不要。分别在各包测。）

**Interfaces:**
- 每个 `apply`：`ctx.effect(ctx.require<ToolRegistry>("tools").register(...))`
- models-chat：`config.apiKey` 非非空字符串则直接 return；否则 `registerChat("default", createOpenAiCompatChat({ baseUrl, apiKey, model }))` 并 `setDefault("chat", "default")`。`baseUrl` 缺省 `https://api.deepseek.com/v1`，`model` 缺省 `deepseek-chat`。

- [ ] **Step 1: Write the failing tests**

每个包一份 `tests/plugin.test.ts`。fs 示例：

```ts
import { describe, expect, it } from "vitest";
import { Context } from "@flintloom/kernel";
import modelsPlugin from "@flintloom/models";
import toolsPlugin, { type ToolRegistry } from "@flintloom/tools";
import plugin from "../src/index.ts";

describe("fs plugin", () => {
  it("registers fs tool", () => {
    const ctx = new Context();
    ctx.plugin(modelsPlugin);
    ctx.plugin(toolsPlugin);
    ctx.plugin(plugin);
    const names = ctx.require<ToolRegistry>("tools").schemas().map((s) => s.name);
    expect(names).toContain("fs");
  });
});
```

grep / shell / docforge 同构，断言 `grep` / `shell` / `doc_probe`+`doc_parse`。

models-chat：

```ts
it("no apiKey does not configure chat", () => {
  const ctx = new Context();
  ctx.plugin(modelsPlugin);
  ctx.plugin(plugin, {});
  expect(ctx.require<ModelRegistry>("models").snapshot().find((r) => r.kind === "chat")?.configured).toBe(false);
});

it("apiKey registers default chat", () => {
  const ctx = new Context();
  ctx.plugin(modelsPlugin);
  ctx.plugin(plugin, { apiKey: "sk-test", model: "m1", baseUrl: "http://127.0.0.1/v1" });
  expect(ctx.require<ModelRegistry>("models").snapshot().find((r) => r.kind === "chat")?.configured).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/fs/tests/plugin.test.ts packages/grep/tests/plugin.test.ts packages/shell/tests/plugin.test.ts packages/models-chat/tests/plugin.test.ts packages/docforge/tests/plugin.test.ts`

Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

fs `plugin.ts`：

```ts
import type { Context, FlintPlugin } from "@flintloom/kernel";
import type { ToolRegistry } from "@flintloom/tools";
import { createFsTool } from "./index.ts";
```

**不要从 `./index.ts` 再 export default 造成循环。** 把 `createFsTool` 留在 `index.ts`，`plugin.ts` import `{ createFsTool }` 从 `./index.ts` 会环（index 再 export default plugin）。拆法：`plugin.ts` 只从当前文件旁边的实现 import。fs 的实现就在 `index.ts`。改为：

`index.ts` 末尾：

```ts
import type { Context, FlintPlugin } from "@flintloom/kernel";
import type { ToolRegistry } from "@flintloom/tools";

const plugin: FlintPlugin = {
  name: "@flintloom/fs",
  apply(ctx: Context) {
    const tools = ctx.require<ToolRegistry>("tools");
    ctx.effect(tools.register(createFsTool()));
  },
};

export default plugin;
```

grep / shell / docforge 同样写在各自 `index.ts` 末尾（docforge 的 `index.ts` 已有 named export，末尾加 default）。

models-chat `index.ts` 末尾 `apply` 读 `config.apiKey` 等，调用已有 `createOpenAiCompatChat`。

各 `package.json` dependencies 加上 `"@flintloom/kernel": "workspace:*"`。docforge 已有 tools。models-chat 已有 models。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/fs packages/grep packages/shell packages/models-chat packages/docforge`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/fs packages/grep packages/shell packages/models-chat packages/docforge
git commit -m "feat: export apply plugins for tools and chat"
```

---

### Task 6: loop 插件与 `runTurn({ ctx })`

**Files:**
- Modify: `packages/loop/src/run-turn.ts`
- Create: `packages/loop/src/plugin.ts` 或在 `index.ts` 加 default
- Modify: `packages/loop/src/index.ts`
- Modify: `packages/loop/package.json`（加 `@flintloom/kernel`）
- Modify: `packages/loop/tests/run-turn.test.ts`

**Interfaces:**
- Consumes: `ctx.require("models")`、`ctx.require("tools")`
- Produces:
```ts
export interface RunTurnInput {
  ctx: Context;
  session: Session;
  text: string;
  workspaceRoot: string;
  channel: string;
  signal: AbortSignal;
  onEvent?: (event: SessionEvent) => void;
}

export type LoopService = {
  runTurn(input: RunTurnInput): Promise<RunTurnResult>;
};
```

default export：`ctx.provide("loop", { runTurn })`。

- [ ] **Step 1: Write the failing test**

改 `run-turn.test.ts` 三个用例：去掉 input 里的 `models`/`tools`，改为：

```ts
import { Context } from "@flintloom/kernel";
import modelsPlugin from "@flintloom/models";
import toolsPlugin, { type ToolRegistry } from "@flintloom/tools";
import loopPlugin, { runTurn } from "../src/index.ts";

function boot() {
  const ctx = new Context();
  ctx.plugin(modelsPlugin);
  ctx.plugin(toolsPlugin);
  ctx.plugin(loopPlugin);
  return ctx;
}

// 假 chat 用例：
const ctx = boot();
ctx.require<ModelRegistry>("models").registerChat("fake", fakeChat);
ctx.require<ModelRegistry>("models").setDefault("chat", "fake");
ctx.require<ToolRegistry>("tools").register(createFsTool());
await runTurn({ ctx, session, text, workspaceRoot, channel, signal });
```

另加：

```ts
it("loop plugin provides runTurn", async () => {
  const ctx = boot();
  const loop = ctx.require<LoopService>("loop");
  expect(typeof loop.runTurn).toBe("function");
});
```

缺 chat 的用例：只 `boot()` + `runTurn({ ctx, ... })`，不断言 models 入参。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/loop/tests/run-turn.test.ts`

Expected: FAIL（`RunTurnInput` 仍要求 models）

- [ ] **Step 3: Write minimal implementation**

`runTurn` 开头：

```ts
const models = input.ctx.require<ModelRegistry>("models");
const tools = input.ctx.require<ToolRegistry>("tools");
```

删除 input 上的 `models`/`tools` 字段。`index.ts` 导出 `LoopService` 与 default plugin。

本任务结束后 **host 会红**：`createRuntime` 仍把 `{ models, tools }` 传给 `runTurn`。下一步立刻改 host。若要本任务单独绿，可暂时让 host 测试在 Task 6 Step 4 **一起**改 `runTurn` 调用（见 Task 7）。**本任务 Step 4 只跑 loop 包。** 不要在这里改 host 的 `runTurn` 调用以外的组装；但 `apps/host/src/server.ts` 里 `runTurn({ ..., models, tools })` 会 typecheck 失败。

因此本任务 **必须** 把 `server.ts` 的 `runTurn` 调用改成传 `ctx`（仍可继续手工 register）。`bin.ts` 同样。这不是完整 boot，只是签名对齐：

```ts
const result = await runTurn({
  ctx: opts.runtime.ctx,
  session,
  text: body.text,
  workspaceRoot: opts.workspaceRoot,
  channel: "host",
  signal: controller.signal,
  onEvent: ...
});
```

CLI：

```ts
const runtime = createRuntime(...); // 下一任务才 async
await runTurn({ ctx: runtime.ctx, session, text, workspaceRoot: workspace, channel: "cli", signal });
```

Task 6 仍用同步 `createRuntime`，host 继续手工 register，只改 `runTurn` 参数。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/loop apps/host apps/cli`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/loop apps/host/src/server.ts apps/cli/src/bin.ts
git commit -m "feat: drive runTurn from ctx.models and ctx.tools"
```

---

### Task 7: host/CLI 只 boot；默认 yml；验收

**Files:**
- Modify: `flintloom.yml`
- Modify: `apps/host/src/server.ts`
- Modify: `apps/host/src/index.ts`（若需导出类型）
- Modify: `apps/host/package.json`（去掉对 fs/grep/shell/models-chat 的依赖；**保留** `docforge` 给 `files.ts` 纯函数；保留 kernel/loop/models/session/tools 作类型与 `WorkspaceEscapeError`）
- Modify: `apps/cli/src/bin.ts`
- Modify: `apps/cli/package.json`（可去掉对 loop 的运行时 import，仅类型则保留或改从 host 走）
- Modify: `apps/host/tests/server.test.ts`
- Modify: `apps/host/tests/files.test.ts`

**Interfaces:**
- Consumes: `applyConfig`、`loadConfig`、`readFileSync` yml
- Produces:
```ts
export type Runtime = { ctx: Context };

export async function createRuntime(
  workspaceRoot: string,
  homeDir: string,
): Promise<Runtime>
```

缺 yml 文件：`throw new Error("plugins")`。`startHost` `await createRuntime`。凭证 overlay 的 id 必须是 `models-chat`。

host `src`（不含 tests）字符串不得包含 `@flintloom/fs`、`@flintloom/grep`、`@flintloom/shell`、`@flintloom/models-chat`、`createDocProbeTool`、`createDocParseTool`。

- [ ] **Step 1: Write the failing tests**

在 `server.test.ts` 增加共享：

```ts
const ASSEMBLY = `plugins:
  - id: models
    name: "@flintloom/models"
  - id: tools
    name: "@flintloom/tools"
  - id: session
    name: "@flintloom/session"
  - id: models-chat
    name: "@flintloom/models-chat"
  - id: fs
    name: "@flintloom/fs"
  - id: grep
    name: "@flintloom/grep"
  - id: shell
    name: "@flintloom/shell"
  - id: docforge
    name: "@flintloom/docforge"
  - id: loop
    name: "@flintloom/loop"
`;

function writeAssembly(workspaceRoot: string): void {
  writeFileSync(join(workspaceRoot, "flintloom.yml"), ASSEMBLY);
}
```

每个 `mkdtempSync` 工作区在 `startHost`/`createRuntime` 前调用 `writeAssembly`，**除了**「invalid yml」那条。

新增：

```ts
it("missing flintloom.yml refuses to start", async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-host-noyaml-"));
  const homeDir = mkdtempSync(join(tmpdir(), "flintloom-host-home-"));
  await expect(createRuntime(workspaceRoot, homeDir)).rejects.toThrow(/plugins/);
});

it("omitting fs from yml omits the fs tool", async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-host-nofs-"));
  const homeDir = mkdtempSync(join(tmpdir(), "flintloom-host-home-"));
  writeFileSync(
    join(workspaceRoot, "flintloom.yml"),
    `plugins:
  - id: models
    name: "@flintloom/models"
  - id: tools
    name: "@flintloom/tools"
  - id: session
    name: "@flintloom/session"
  - id: loop
    name: "@flintloom/loop"
`,
  );
  const { ctx } = await createRuntime(workspaceRoot, homeDir);
  const names = ctx.require<ToolRegistry>("tools").schemas().map((s) => s.name);
  expect(names).not.toContain("fs");
});

it("host src does not import tool factories", () => {
  const server = readFileSync(join(__dirname, "../src/server.ts"), "utf8");
  const index = readFileSync(join(__dirname, "../src/index.ts"), "utf8");
  const src = server + index;
  expect(src).not.toMatch(/@flintloom\/fs/);
  expect(src).not.toMatch(/@flintloom\/grep/);
  expect(src).not.toMatch(/@flintloom\/shell/);
  expect(src).not.toMatch(/@flintloom\/models-chat/);
  expect(src).not.toMatch(/createDocProbeTool/);
  expect(src).not.toMatch(/createDocParseTool/);
});
```

（`__dirname` 在 ESM 下用 `fileURLToPath(new URL(".", import.meta.url))`。）

dotenv 用例：`writeAssembly` + `await createRuntime` + `ctx.require<ModelRegistry>("models").snapshot()`。

doc 工具用例：同样改 `ctx.require<ToolRegistry>("tools")`。

invalid yml：`await expect(createRuntime(...)).rejects.toThrow(/plugins/)`。

files.test.ts：`startWithFixture` 以及另外两处 `startHost` 前 `writeAssembly`（把 helper 抽到 `apps/host/tests/assembly.ts` 以免复制）。

另增 turn 无 key：`writeAssembly`、`startHost`、`POST /v1/turns`，SSE 含 `model/error` 且最终 `failed`。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run apps/host/tests/server.test.ts`

Expected: FAIL（yml 仍被忽略；`createRuntime` 仍同步；src 仍有 factory import）

- [ ] **Step 3: Write minimal implementation**

`flintloom.yml` 改为 Task 7 Step 1 的 `ASSEMBLY` 内容（可保留文件头注释）。

`createRuntime`：

```ts
export async function createRuntime(
  workspaceRoot: string,
  homeDir: string,
): Promise<Runtime> {
  const ymlPath = join(workspaceRoot, "flintloom.yml");
  if (!existsSync(ymlPath)) {
    throw new Error("plugins");
  }
  const config = loadConfig(readFileSync(ymlPath, "utf8"));
  const fileEnv = readDotEnv(join(workspaceRoot, ".env"));
  const apiKey = resolveChatApiKey(homeDir, fileEnv);
  const runtimeConfigById: Record<string, Record<string, unknown>> = {};
  if (apiKey !== undefined) {
    runtimeConfigById["models-chat"] = {
      apiKey,
      baseUrl:
        firstNonEmpty(process.env.FLINTLOOM_BASE_URL, fileEnv.FLINTLOOM_BASE_URL) ??
        "https://api.deepseek.com/v1",
      model:
        firstNonEmpty(
          process.env.FLINTLOOM_CHAT_MODEL,
          fileEnv.FLINTLOOM_CHAT_MODEL,
        ) ?? "deepseek-chat",
    };
  }

  const ctx = new Context();
  await applyConfig(ctx, config, { runtimeConfigById });
  return { ctx };
}
```

删除对 fs/grep/shell/models-chat 工厂和 `createDoc*` 的 import。删除 `new ModelRegistry` / `new ToolRegistry` / `new Map` sessions。

`GET /v1/models`：`opts.runtime.ctx.require<ModelRegistry>("models").snapshot()`。

`GET /v1/sessions/:id`：`ctx.require<SessionStore>("sessions").get(...)`。

`POST /v1/turns`：`getOrCreate` + `ctx.require<LoopService>("loop").runTurn({ ctx, session, text, workspaceRoot, channel: "host", signal, onEvent })`。删除 `import { runTurn } from "@flintloom/loop"` 的值 import（类型 `LoopService` 可留）。

`startHost`：`const runtime = await createRuntime(...)`。

CLI：

```ts
const { ctx } = await createRuntime(workspace, homedir());
const session = ctx.require<SessionStore>("sessions").getOrCreate("cli");
const { status } = await ctx.require<LoopService>("loop").runTurn({
  ctx,
  session,
  text,
  workspaceRoot: workspace,
  channel: "cli",
  signal: new AbortController().signal,
});
```

`apps/host/package.json` dependencies 删除 `@flintloom/fs`、`grep`、`shell`、`models-chat`。保留 `@flintloom/docforge`（`files.ts`）。保留 `@flintloom/loop` 仅若仍 import 类型。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test`

Expected: 全仓 PASS

- [ ] **Step 5: Commit**

```bash
git add flintloom.yml apps/host apps/cli packages/loop
git commit -m "feat: boot host and flint from flintloom.yml plugins"
```

---

## Self-review

**Spec coverage**

| Spec | 任务 |
|---|---|
| `require` / `effect` / `hook` / `waterfall` | Task 1 |
| `applyConfig`、unwrap、重复 id、失败回滚 | Task 2 |
| models / sessions 服务插件 | Task 3 |
| `tools/pre-execute`、闸门在前、guard 监听、ask 文案 | Task 4 |
| fs/grep/shell/docforge/models-chat `apply` | Task 5 |
| loop 插件、`runTurn({ ctx })` | Task 6 |
| 默认 yml、host 变薄、缺 yml、无 fs、无 chat 启动、CLI | Task 7 |
| host src 禁止 factory import | Task 7 |
| 不改预览 HTTP / 工具行为 | 无任务改 `files.ts` 解析决策；仅补 yml |

**Placeholder scan:** 无 TBD。apply 第二参 `config` 是 spec「models-chat 读 config」的落地，写进 Global Constraints。

**Type consistency:** `Runtime = { ctx }`；`SessionStore.getOrCreate`；`LoopService.runTurn`；`ToolRegistry.execute` 三参；`createRuntime` 为 `async`。
