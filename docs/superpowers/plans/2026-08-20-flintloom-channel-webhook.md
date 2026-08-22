# FlintLoom webhook channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Host 在 yml 挂上 `@flintloom/channel-webhook` 后提供 `POST /v1/hooks`：Bearer hostToken、等到 `runTurn({ channel: "webhook" })` 结束，返回 `{ turnId, status, text }`；session 事件与同一 `text` 的桌面 `runTurn` 同构。

**Architecture:** `@flintloom/channel` `provide("channels")` 登记表。`@flintloom/channel-webhook` `apply` 登记 `"webhook"` 适配器，内部 `getOrCreate` + `runTurn`，**不**传 `onEvent`。Host 拥有 listen / token / drain / busy / JSON；**禁止**为 webhook 调用 `runTurn`，禁止 import `@flintloom/channel-webhook`。`busy: Set<string>` 覆盖 `/v1/turns`、`/v1/turns/:id/actions`、`/v1/hooks`。

**Tech Stack:** 现有 `@flintloom/kernel` `apply` / `provide` / `effect` / `require`，`@flintloom/session`，`@flintloom/loop` `runTurn`，host `readBody` / `sendJson` / `sessionHasWaitingTurn`。不新增第三方 npm 包。假 `ChatProvider`；不打真实网。

## Global Constraints

- 产品名 FlintLoom；包前缀 `@flintloom/*`；只绑 `127.0.0.1`。
- 不 import / submodule / 拷贝 dataagent-v3、deepseek-harness、Cordis。
- 禁止往 `createRuntime` 里 `register`。Host 不把 HTTP 路由做成插件。
- `apps/host/src` 不得出现 `@flintloom/channel-webhook`、`createWebhookAdapter`、`lastAssistantText`。允许 `import type` `@flintloom/channel`。不要用正则禁止单词 `hooks` 或 `channel`。
- loop 保持 `if (channel === "host" && stepWait)`，不要改成 `channel !== "cli"`。
- webhook **不**写入 `controllers` / `turns`；进行中 `POST /v1/turns/:id/cancel` 对 webhook 为 404。取消只靠断开 hooks。
- 不加 HTTP / turn deadline。
- `failed` / `cancelled` 也是 HTTP 200。JSON 键顺序固定 `turnId`、`status`、`text`。
- 同一 `id` 再 `register` → throw，message 含该 id。未知 `inbound` id 同样。
- 凡 `startHost` 后会跑 `runTurn` 的用例：`registerChat` 之后必须 `setDefault("chat", 假 id)`。
- Windows：指定文件 `git add`；不要 `git add -A`。不要提交 `check_libs.py`、`scripts/desktop-dev.ts`。PowerShell 用 `git commit -m @"` / `"@`，不要 bash heredoc 的 `EOF` 行。
- Spec：`docs/superpowers/specs/2026-08-20-flintloom-channel-webhook-design.md`

## File map

```text
packages/channel/package.json
packages/channel/src/registry.ts          # createChannelRegistry
packages/channel/src/plugin.ts
packages/channel/src/index.ts
packages/channel/tests/registry.test.ts

packages/channel-webhook/package.json
packages/channel-webhook/src/text.ts      # lastAssistantText
packages/channel-webhook/src/adapter.ts   # createWebhookAdapter
packages/channel-webhook/src/plugin.ts
packages/channel-webhook/src/index.ts
packages/channel-webhook/tests/text.test.ts
packages/channel-webhook/tests/adapter.test.ts
packages/channel-webhook/tests/isomorphism.test.ts

packages/loop/tests/run-turn.test.ts      # channel: "webhook" 不暂停

apps/host/src/server.ts                   # busy、runtime、POST /v1/hooks、/v1/turns wrap
apps/host/src/a2ui.ts                     # handleTurnActions 使用 busy
apps/host/package.json                    # 依赖 @flintloom/channel
apps/host/tests/a2ui.test.ts              # 调用处传入 busy Set
apps/host/tests/assembly.ts               # 追加两行插件
apps/host/tests/server.test.ts            # factory 扫描；并发 turns 409
apps/host/tests/webhook.test.ts           # HTTP 契约

flintloom.yml
package.json                              # 根 devDependencies 两个新包
pnpm-lock.yaml
```

不改 desktop UI、DocForge、`models-chat`、CLI `channel: "cli"` 入站、`packages/channel-desktop`。

---

### Task 1: `@flintloom/channel` 登记表

**Files:**
- Create: `packages/channel/package.json`
- Create: `packages/channel/src/registry.ts`
- Create: `packages/channel/src/plugin.ts`
- Create: `packages/channel/src/index.ts`
- Create: `packages/channel/tests/registry.test.ts`
- Modify: `package.json`（根 `devDependencies` 增加 `"@flintloom/channel": "workspace:*"`，放在 `@flintloom/a2ui` 与 `@flintloom/docforge` 之间按字母序）
- Modify: `pnpm-lock.yaml`（根目录 `pnpm install` 若有 diff 则纳入）

**Interfaces:**
- Consumes: `@flintloom/kernel` `Context` / `FlintPlugin`
- Produces:

```ts
export type ChannelInbound = {
  text: string;
  sessionId: string;
  workspaceRoot: string;
  signal: AbortSignal;
};

export type ChannelInboundResult = {
  turnId: string;
  status: "ok" | "failed" | "cancelled" | "awaiting_action";
  text: string;
};

export type ChannelAdapter = {
  inbound(input: ChannelInbound): Promise<ChannelInboundResult>;
};

export type ChannelRegistry = {
  has(id: string): boolean;
  register(id: string, adapter: ChannelAdapter): () => void;
  inbound(id: string, input: ChannelInbound): Promise<ChannelInboundResult>;
};

export function createChannelRegistry(): ChannelRegistry;
```

服务键字面量 `"channels"`。插件 `name: "@flintloom/channel"`。本任务 **没有** `send` / `deliver` / `lastAssistantText`。

- [ ] **Step 1: Write the failing test**

`packages/channel/tests/registry.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { Context } from "@flintloom/kernel";
import channelPlugin, {
  createChannelRegistry,
  type ChannelInbound,
  type ChannelRegistry,
} from "../src/index.ts";

const input: ChannelInbound = {
  text: "hi",
  sessionId: "webhook",
  workspaceRoot: "/tmp",
  signal: new AbortController().signal,
};

describe("channels registry", () => {
  it("plugin provides channels; register inbound dispose clears has", async () => {
    const ctx = new Context();
    const stop = ctx.plugin(channelPlugin);
    const channels = ctx.require<ChannelRegistry>("channels");
    const unregister = channels.register("webhook", {
      async inbound(next) {
        expect(next.text).toBe("hi");
        return { turnId: "t1", status: "ok", text: "out" };
      },
    });
    expect(channels.has("webhook")).toBe(true);
    await expect(channels.inbound("webhook", input)).resolves.toEqual({
      turnId: "t1",
      status: "ok",
      text: "out",
    });
    unregister();
    expect(channels.has("webhook")).toBe(false);
    stop();
    expect(() => ctx.require<ChannelRegistry>("channels")).toThrow(/channels/);
  });

  it("throws on unknown inbound id and duplicate register", () => {
    const channels = createChannelRegistry();
    const adapter = {
      async inbound() {
        return { turnId: "t", status: "ok" as const, text: "" };
      },
    };
    channels.register("webhook", adapter);
    expect(() => channels.register("webhook", adapter)).toThrow(/webhook/);
    expect(() => channels.inbound("nope", input)).toThrow(/nope/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/channel/tests/registry.test.ts`

Expected: FAIL（模块不存在）

- [ ] **Step 3: Write minimal implementation**

`packages/channel/package.json`：

```json
{
  "name": "@flintloom/channel",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@flintloom/kernel": "workspace:*"
  }
}
```

`packages/channel/src/registry.ts`：把类型与 `createChannelRegistry` 放这里。`register`：若 `adapters.has(id)` 则 `throw new Error(id)`。`inbound`：没有适配器则 `throw new Error(id)`。disposer：`adapters.delete(id)`。

`packages/channel/src/plugin.ts`：

```ts
import type { Context, FlintPlugin } from "@flintloom/kernel";
import { createChannelRegistry } from "./registry.ts";

const plugin: FlintPlugin = {
  name: "@flintloom/channel",
  apply(ctx: Context) {
    ctx.provide("channels", createChannelRegistry());
  },
};

export default plugin;
```

`packages/channel/src/index.ts`：re-export 类型、`createChannelRegistry`、`default` plugin。

根 `package.json` `devDependencies` 增加 `"@flintloom/channel": "workspace:*"`。然后在仓库根执行 `pnpm install`。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/channel/tests/registry.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/channel package.json pnpm-lock.yaml
git commit -m "feat: add channels inbound registry plugin"
```

（若 lockfile 无 diff 则不要 add 它。）

---

### Task 2: webhook 适配器与事件同构

**Files:**
- Create: `packages/channel-webhook/package.json`
- Create: `packages/channel-webhook/src/text.ts`
- Create: `packages/channel-webhook/src/adapter.ts`
- Create: `packages/channel-webhook/src/plugin.ts`
- Create: `packages/channel-webhook/src/index.ts`
- Create: `packages/channel-webhook/tests/text.test.ts`
- Create: `packages/channel-webhook/tests/adapter.test.ts`
- Create: `packages/channel-webhook/tests/isomorphism.test.ts`
- Modify: `package.json`（根 `devDependencies` 增加 `"@flintloom/channel-webhook": "workspace:*"`，紧挨 `@flintloom/channel`）
- Modify: `pnpm-lock.yaml`（`pnpm install` 若有 diff）

**Interfaces:**
- Consumes: Task 1 的 `ChannelRegistry` / `ChannelAdapter` / `ChannelInbound`；`SessionStore.getOrCreate`；`LoopService.runTurn`
- Produces:

```ts
export function lastAssistantText(
  events: readonly SessionEvent[],
  turnId: string,
): string;

export function createWebhookAdapter(ctx: Context): ChannelAdapter;
```

插件 `name: "@flintloom/channel-webhook"`。`apply`：`ctx.require("channels")`、`ctx.require("sessions")`、`ctx.require("loop")`，然后 `ctx.effect(channels.register("webhook", createWebhookAdapter(ctx)))`。`runTurn` **不得**传 `onEvent`。`packages/channel/src` 不得出现 `lastAssistantText` / `createWebhookAdapter`。

- [ ] **Step 1: Write failing `lastAssistantText` tests**

`packages/channel-webhook/tests/text.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import type { SessionEvent } from "@flintloom/session";
import { lastAssistantText } from "../src/text.ts";

describe("lastAssistantText", () => {
  it("returns the last assistant/message of the matching turn only", () => {
    const events: SessionEvent[] = [
      { type: "turn/start", turnId: "t0" },
      { type: "assistant/message", text: "old" },
      { type: "turn/end", turnId: "t0", status: "ok" },
      { type: "turn/start", turnId: "t1" },
      { type: "user/message", text: "hi" },
      { type: "assistant/chunk", text: "x" },
      { type: "assistant/message", text: "first" },
      { type: "assistant/message", text: "second" },
      { type: "model/error", kind: "chat", message: "nope" },
    ];
    expect(lastAssistantText(events, "t1")).toBe("second");
    expect(lastAssistantText(events, "t0")).toBe("old");
    expect(lastAssistantText(events, "missing")).toBe("");
  });
});
```

- [ ] **Step 2: Run text test to verify it fails**

Run: `pnpm exec vitest run packages/channel-webhook/tests/text.test.ts`

Expected: FAIL（模块不存在）

- [ ] **Step 3: Implement `lastAssistantText`**

把 spec §5.4 的函数原文放进 `packages/channel-webhook/src/text.ts`（`export function lastAssistantText`）。只认 `assistant/message`。

- [ ] **Step 4: Run text test to verify it passes**

Run: `pnpm exec vitest run packages/channel-webhook/tests/text.test.ts`

Expected: PASS

- [ ] **Step 5: Write failing adapter + plugin tests**

`packages/channel-webhook/tests/adapter.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { Context } from "@flintloom/kernel";
import type { LoopService, RunTurnInput } from "@flintloom/loop";
import sessionPlugin from "@flintloom/session";
import channelPlugin, { type ChannelRegistry } from "@flintloom/channel";
import webhookPlugin, { createWebhookAdapter } from "../src/index.ts";

describe("createWebhookAdapter", () => {
  it("calls runTurn with channel webhook and no onEvent", async () => {
    const ctx = new Context();
    ctx.plugin(sessionPlugin);
    let captured: RunTurnInput | undefined;
    const loop: LoopService = {
      async runTurn(input) {
        captured = input;
        input.session.append({ type: "turn/start", turnId: "t1" });
        input.session.append({ type: "user/message", text: input.text });
        input.session.append({ type: "assistant/message", text: "hello" });
        return { turnId: "t1", status: "ok" };
      },
      async continueTurn() {
        throw new Error("continueTurn");
      },
    };
    ctx.provide("loop", loop);
    const adapter = createWebhookAdapter(ctx);
    const result = await adapter.inbound({
      text: "hi",
      sessionId: "s1",
      workspaceRoot: "/tmp",
      signal: new AbortController().signal,
    });
    expect(captured?.channel).toBe("webhook");
    expect(captured?.onEvent).toBeUndefined();
    expect(captured?.session.id).toBe("s1");
    expect(result).toEqual({ turnId: "t1", status: "ok", text: "hello" });
  });

  it("apply registers webhook and stop unregisters", () => {
    const ctx = new Context();
    ctx.plugin(sessionPlugin);
    ctx.provide("loop", {
      runTurn: async () => ({ turnId: "t", status: "ok" as const }),
      continueTurn: async () => ({ turnId: "t", status: "ok" as const }),
    });
    ctx.plugin(channelPlugin);
    const stop = ctx.plugin(webhookPlugin);
    const channels = ctx.require<ChannelRegistry>("channels");
    expect(channels.has("webhook")).toBe(true);
    stop();
    expect(channels.has("webhook")).toBe(false);
  });
});
```

第二个用例的假 `runTurn` 必须返回 `RunTurnResult`（只有 `turnId` + `status`，没有 `text`）。上面代码已按此书写。不要 import 未使用的 `Session`。

- [ ] **Step 6: Run adapter test to verify it fails**

Run: `pnpm exec vitest run packages/channel-webhook/tests/adapter.test.ts`

Expected: FAIL

- [ ] **Step 7: Implement adapter + plugin + package.json**

`packages/channel-webhook/package.json`：

```json
{
  "name": "@flintloom/channel-webhook",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@flintloom/channel": "workspace:*",
    "@flintloom/kernel": "workspace:*",
    "@flintloom/loop": "workspace:*",
    "@flintloom/session": "workspace:*"
  }
}
```

`adapter.ts`：`createWebhookAdapter(ctx)` 返回 `{ inbound }`：`sessions.getOrCreate(input.sessionId)`，`loop.runTurn({ ctx, session, text: input.text, workspaceRoot: input.workspaceRoot, channel: "webhook", signal: input.signal })`（五字段 + ctx，**不要** `onEvent`），然后 `text: lastAssistantText(session.events(), result.turnId)`。

`plugin.ts` 按 spec §5.2。`index.ts` 导出 `lastAssistantText`、`createWebhookAdapter`、类型需要的再 export、`default` plugin。

根 `package.json` 加 `@flintloom/channel-webhook`。`pnpm install`。

- [ ] **Step 8: Run adapter tests**

Run: `pnpm exec vitest run packages/channel-webhook/tests/adapter.test.ts`

Expected: PASS

- [ ] **Step 9: Write failing isomorphism test**

`packages/channel-webhook/tests/isomorphism.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { Context } from "@flintloom/kernel";
import loopPlugin, { runTurn } from "@flintloom/loop";
import modelsPlugin, {
  type ChatProvider,
  type ModelRegistry,
} from "@flintloom/models";
import sessionPlugin, { type SessionStore } from "@flintloom/session";
import toolsPlugin from "@flintloom/tools";
import channelPlugin, { type ChannelRegistry } from "@flintloom/channel";
import type { SessionEvent } from "@flintloom/session";
import webhookPlugin from "../src/index.ts";

function textChat(reply: string): ChatProvider {
  return {
    async *stream() {
      yield { type: "text", text: reply };
    },
  };
}

function stripTurnId(events: readonly SessionEvent[]): unknown[] {
  return events.map((event) => {
    if (!("turnId" in event)) {
      return event;
    }
    const { turnId, ...rest } = event;
    return rest;
  });
}

function boot() {
  const ctx = new Context();
  ctx.plugin(modelsPlugin);
  ctx.plugin(toolsPlugin);
  ctx.plugin(sessionPlugin);
  ctx.plugin(loopPlugin);
  ctx.plugin(channelPlugin);
  ctx.plugin(webhookPlugin);
  const models = ctx.require<ModelRegistry>("models");
  models.registerChat("fake", textChat("hello-iso"));
  models.setDefault("chat", "fake");
  return ctx;
}

describe("webhook inbound events", () => {
  it("matches host runTurn events for the same text without a2ui wait", async () => {
    const ctx = boot();
    const sessions = ctx.require<SessionStore>("sessions");
    const inbound = await ctx.require<ChannelRegistry>("channels").inbound("webhook", {
      text: "same-text",
      sessionId: "wh",
      workspaceRoot: process.cwd(),
      signal: new AbortController().signal,
    });
    expect(inbound.status).toBe("ok");
    expect(inbound.text).toBe("hello-iso");
    const hostSession = sessions.getOrCreate("host-iso");
    await runTurn({
      ctx,
      session: hostSession,
      text: "same-text",
      workspaceRoot: process.cwd(),
      channel: "host",
      signal: new AbortController().signal,
    });
    const webhookEvents = sessions.get("wh")!.events();
    expect(stripTurnId(webhookEvents)).toEqual(stripTurnId(hostSession.events()));
  });
});
```

`runTurn` 已从 `@flintloom/loop` 值导入。不要再 import 未使用的 `LoopService`。

- [ ] **Step 10: Run isomorphism test**

Run: `pnpm exec vitest run packages/channel-webhook/tests/isomorphism.test.ts`

Expected: PASS。若 FAIL，修适配器直到同构（同一 `textChat`、无 wait）。不要用 HTTP `/v1/turns` 当对照。

- [ ] **Step 11: Commit**

```bash
git add packages/channel-webhook package.json pnpm-lock.yaml
git commit -m "feat: run webhook inbound turns through channel adapter"
```

---

### Task 3: loop `channel: "webhook"` 不暂停

**Files:**
- Modify: `packages/loop/tests/run-turn.test.ts`（在 cli 不暂停用例旁追加 webhook 用例）
- 不修改 `packages/loop/src/run-turn.ts` 的 `channel === "host"` 判断，除非测试意外 FAIL（那时只改测试，不改条件）

**Interfaces:**
- Consumes: 现有 `confirmMessages`、`boot`、`a2uiPlugin`、`runTurn`
- Produces: 一条断言 `channel: "webhook"` → `status === "ok"` 且有 `turn/end`

- [ ] **Step 1: Write the failing test**

在 `does not pause a2ui wait on cli channel` 之后追加（夹具与 cli 相同，只改 channel / session id / 第二步文本）：

```ts
  it("does not pause a2ui wait on webhook channel", async () => {
    let n = 0;
    const fakeChat: ChatProvider = {
      async *stream() {
        n += 1;
        if (n === 1) {
          yield {
            type: "tool_call",
            id: "c1",
            name: "a2ui_emit",
            args: { messages: confirmMessages() },
          };
        } else {
          yield { type: "text", text: "webhook-skip-wait" };
        }
      },
    };
    const ctx = boot();
    ctx.plugin(a2uiPlugin);
    ctx.require<ModelRegistry>("models").registerChat("fake", fakeChat);
    ctx.require<ModelRegistry>("models").setDefault("chat", "fake");
    const session = new Session("s-webhook");
    const result = await runTurn({
      ctx,
      session,
      text: "emit",
      workspaceRoot: process.cwd(),
      channel: "webhook",
      signal: new AbortController().signal,
    });
    expect(result.status).toBe("ok");
    expect(session.events().some((e) => e.type === "turn/end")).toBe(true);
  });
```

- [ ] **Step 2: Run the new test**

Run: `pnpm exec vitest run packages/loop/tests/run-turn.test.ts`

Expected: PASS（现有判断已排除非 host）。不要把条件改成 `channel !== "cli"`。

- [ ] **Step 3: Commit**

```bash
git add packages/loop/tests/run-turn.test.ts
git commit -m "test: webhook channel does not pause a2ui wait"
```

---

### Task 4: per-session busy + `startHost` 返回 `runtime`

**Files:**
- Modify: `apps/host/src/server.ts`（`startHost` 返回值增加 `runtime`；`busy: Set<string>`；`POST /v1/turns` 在现有 wait 409 之后检查 `busy.has(session.id)`，通过后 `add`，`streamLoopResult` 包在 `try/finally` 里 `delete`；把 `busy` 传入 `handleRequest` / `handleTurnActions`）
- Modify: `apps/host/src/a2ui.ts`（`handleTurnActions` opts 增加 `busy: Set<string>`。现有 409 检查全部通过之后、`streamLoopResult` 之前：若 `busy.has(session.id)` → 409；否则 `busy.add(session.id)`，`try { await streamLoopResult(...) } finally { busy.delete(session.id) }`）
- Modify: `apps/host/tests/a2ui.test.ts`（每个 `handleTurnActions` 调用增加 `busy: new Set()`。该文件已有名为 `busy` 的 mockRes 变量：opts 里写 `busy: new Set<string>()`，不要和 `busy.res` 搞混）
- Modify: `apps/host/tests/server.test.ts`（断言 `startHost` 返回 `runtime`；同一 session 两次并行 `/v1/turns` 第二条 409）

**Interfaces:**
- Consumes: 现有 `sessionHasWaitingTurn`、`streamLoopResult`、`session.id`
- Produces: `startHost` → `{ url, close, runtime: Runtime }`；`busy` 在 turns 与 actions 路径上生效。本任务 **还不** 加 `/v1/hooks`。

检查与 `busy.add` 之间不得 `await`。

- [ ] **Step 1: Write failing host tests**

在 `apps/host/tests/server.test.ts` 现有 `describe("startHost")` 里追加：

```ts
  it("returns runtime and rejects a second in-flight turn on the same session", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-host-busy-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-host-busy-home-"));
    writeAssembly(workspaceRoot);
    const host = await startHost({ workspaceRoot, homeDir, port: 0 });
    close = host.close;
    expect(host.runtime.ctx.require).toBeTypeOf("function");
    const token = loadOrCreateToken(homeDir);
    const models = host.runtime.ctx.require<ModelRegistry>("models");
    models.registerChat("fake", {
      async *stream(_req, signal) {
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => reject(new Error("aborted"));
          if (signal.aborted) {
            onAbort();
            return;
          }
          signal.addEventListener("abort", onAbort, { once: true });
        });
      },
    });
    models.setDefault("chat", "fake");

    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    const first = fetch(`${host.url}/v1/turns`, {
      method: "POST",
      headers,
      body: JSON.stringify({ sessionId: "s-busy", text: "hi" }),
    });
    const started = Date.now();
    let turnReady = false;
    while (Date.now() - started < 5000) {
      const peek = await fetch(`${host.url}/v1/sessions/s-busy`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (peek.status === 200) {
        const body = (await peek.json()) as { events: { type: string }[] };
        if (body.events.some((e) => e.type === "turn/start")) {
          turnReady = true;
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(turnReady).toBe(true);
    const second = await fetch(`${host.url}/v1/turns`, {
      method: "POST",
      headers,
      body: JSON.stringify({ sessionId: "s-busy", text: "again" }),
    });
    expect(second.status).toBe(409);
    await host.close();
    close = undefined;
    await first.catch(() => undefined);
  });
```

`toBeTypeOf` 若 vitest 版本不喜欢，改成 `expect(typeof host.runtime.ctx.require).toBe("function")`。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run apps/host/tests/server.test.ts`

Expected: FAIL（`runtime` 不存在，或第二条 turns 不是 409）

- [ ] **Step 3: Implement busy + runtime**

`startHost`：`const busy = new Set<string>()`；`handleRequest` opts 增加 `busy`；返回 `{ url, close, runtime }`。

`POST /v1/turns` 在 `getOrCreate` 之后：

```ts
    if (sessionHasWaitingTurn(session) || opts.busy.has(session.id)) {
      send(res, 409);
      return;
    }
    opts.busy.add(session.id);
    try {
      await streamLoopResult(/* 与现在相同的参数 */);
    } finally {
      opts.busy.delete(session.id);
    }
```

`handleTurnActions`：opts 加 `busy`。在 `validateAction` 成功之后：

```ts
  if (opts.busy.has(session.id)) {
    send(res, 409);
    return true;
  }
  opts.busy.add(session.id);
  try {
    await opts.streamLoopResult(/* 现有 continueTurn 调用 */);
  } finally {
    opts.busy.delete(session.id);
  }
  return true;
```

`server.ts` 里调用 `handleTurnActions` 时传入 `busy: opts.busy`。

`listen.ts` 继续只解构 `url`。

- [ ] **Step 4: Run host + a2ui tests**

Run: `pnpm exec vitest run apps/host/tests/server.test.ts apps/host/tests/a2ui.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/host/src/server.ts apps/host/src/a2ui.ts apps/host/tests/a2ui.test.ts apps/host/tests/server.test.ts
git commit -m "feat: serialize in-flight host turns per session"
```

---

### Task 5: `POST /v1/hooks` + 默认装配

**Files:**
- Modify: `apps/host/src/server.ts`（`parseHookBody`、`POST /v1/hooks`；允许 `import type { ChannelRegistry } from "@flintloom/channel"`）
- Modify: `apps/host/package.json`（`dependencies` 增加 `"@flintloom/channel": "workspace:*"`）
- Modify: `flintloom.yml`（`loop` 后追加 channel 两行）
- Modify: `apps/host/tests/assembly.ts`（同样两行）
- Modify: `apps/host/tests/server.test.ts`（factory 扫描增加三行 `not.toMatch`）
- Create: `apps/host/tests/webhook.test.ts`
- Modify: `pnpm-lock.yaml`（host 新依赖后 `pnpm install`）

**Interfaces:**
- Consumes: Task 1 `ChannelRegistry.has` / `inbound`；Task 2 适配器；Task 4 `busy` / `runtime`
- Produces: `POST /v1/hooks` 契约（spec §5.3 / §7 / §9.5–9.7）

yml 两行必须是：

```yaml
  - id: channel
    name: "@flintloom/channel"
  - id: channel-webhook
    name: "@flintloom/channel-webhook"
```

`parseHookBody(raw)`：非法 JSON / 非对象 / `text` 非 string / `sessionId` 出现但非 string / trim 后 `text` 空 → `undefined`。成功返回 `{ text: trimmed, sessionId }`，`sessionId` 缺省或 trim 空 → `"webhook"`。其它键忽略。

hooks 处理顺序：鉴权已在 `/v1/*` 统一做完 → **先 `readBody`** → `get("channels")` 无或 `!has("webhook")` → 404 → parse 失败 400 → `getOrCreate` → wait 或 busy → 409 → `busy.add` → `req.on("close", abort)` → `try inbound finally { off; busy.delete }` → `sendJson(200, { turnId, status, text })`。inbound 抛错不要在本函数吞掉（外层 500）。**不要**把 turnId 写入 `controllers` / `turns`。

- [ ] **Step 1: Write failing webhook HTTP tests**

`apps/host/tests/webhook.test.ts`：

```ts
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { ChatProvider } from "@flintloom/models";
import { ModelRegistry } from "@flintloom/models";
import { loadOrCreateToken, startHost } from "../src/index.ts";
import { writeAssembly } from "./assembly.ts";

const here = fileURLToPath(new URL(".", import.meta.url));

function hangChat(): ChatProvider {
  return {
    async *stream(_req, signal) {
      await new Promise<void>((_resolve, reject) => {
        const onAbort = () => reject(new Error("aborted"));
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      });
    },
  };
}

function textChat(text: string): ChatProvider {
  return {
    async *stream() {
      yield { type: "text", text };
    },
  };
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function waitForTurnStart(
  url: string,
  token: string,
  sessionId: string,
): Promise<string> {
  const started = Date.now();
  while (Date.now() - started < 5000) {
    const peek = await fetch(`${url}/v1/sessions/${sessionId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (peek.status === 200) {
      const body = (await peek.json()) as {
        events: { type: string; turnId?: string }[];
      };
      const start = body.events.find((e) => e.type === "turn/start");
      if (start?.turnId) {
        return start.turnId;
      }
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("timeout waiting for turn/start");
}

describe("POST /v1/hooks", () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (close) {
      await close();
      close = undefined;
    }
  });

  it("returns 401 without bearer and 404 when channel-webhook is omitted", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-hooks-omit-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-hooks-omit-home-"));
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
    const unauth = await fetch(`${host.url}/v1/hooks`, {
      method: "POST",
      body: JSON.stringify({ text: "hi" }),
    });
    expect(unauth.status).toBe(401);
    const token = loadOrCreateToken(homeDir);
    const res = await fetch(`${host.url}/v1/hooks`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({ text: "hi" }),
    });
    expect(res.status).toBe(404);
  });

  it("accepts a turn and defaults session id webhook", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-hooks-ok-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-hooks-ok-home-"));
    writeAssembly(workspaceRoot);
    const host = await startHost({ workspaceRoot, homeDir, port: 0 });
    close = host.close;
    const token = loadOrCreateToken(homeDir);
    const models = host.runtime.ctx.require<ModelRegistry>("models");
    models.registerChat("fake", textChat("hook-hello"));
    models.setDefault("chat", "fake");
    const res = await fetch(`${host.url}/v1/hooks`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({ text: "  hi  " }),
    });
    expect(res.status).toBe(200);
    const raw = await res.text();
    const body = JSON.parse(raw) as { turnId: string; status: string; text: string };
    expect(Object.keys(JSON.parse(raw) as object)).toEqual(["turnId", "status", "text"]);
    expect(body.status).toBe("ok");
    expect(body.text).toBe("hook-hello");
    const session = await fetch(`${host.url}/v1/sessions/webhook`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const log = (await session.json()) as { events: { type: string; text?: string }[] };
    const user = log.events.find((e) => e.type === "user/message");
    expect(user?.text).toBe("hi");
  });

  it("returns 400 for empty text and 409 while a turn is in flight", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-hooks-err-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-hooks-err-home-"));
    writeAssembly(workspaceRoot);
    const host = await startHost({ workspaceRoot, homeDir, port: 0 });
    close = host.close;
    const token = loadOrCreateToken(homeDir);
    const models = host.runtime.ctx.require<ModelRegistry>("models");
    models.registerChat("fake", hangChat());
    models.setDefault("chat", "fake");
    const empty = await fetch(`${host.url}/v1/hooks`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({ text: "  " }),
    });
    expect(empty.status).toBe(400);
    const pending = fetch(`${host.url}/v1/hooks`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({ text: "hi", sessionId: "s-hang" }),
    });
    const turnId = await waitForTurnStart(host.url, token, "s-hang");
    const overlap = await fetch(`${host.url}/v1/hooks`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({ text: "again", sessionId: "s-hang" }),
    });
    expect(overlap.status).toBe(409);
    const cancel = await fetch(`${host.url}/v1/turns/${turnId}/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(cancel.status).toBe(404);
    await host.close();
    close = undefined;
    await pending.catch(() => undefined);
  });
});

describe("host src factory scan", () => {
  it("does not import webhook adapter", () => {
    const srcDir = join(here, "../src");
    const src = readdirSync(srcDir)
      .filter((name) => name.endsWith(".ts"))
      .map((name) => readFileSync(join(srcDir, name), "utf8"))
      .join("\n");
    expect(src).not.toMatch(/@flintloom\/channel-webhook/);
    expect(src).not.toMatch(/createWebhookAdapter/);
    expect(src).not.toMatch(/lastAssistantText/);
  });
});
```

omit 用例手写短 yml（不含 channel 两行），不要对 `ASSEMBLY` 做 replace。

再追加两个用例（可写在同一 describe）：

1. `POST /v1/turns` 挂起后，同一 `sessionId` 打 hooks → 409。假 chat 用 `hangChat` + `setDefault`。先 `fetch /v1/turns`，`waitForTurnStart`，再 hooks。
2. 断开 hooks：`AbortController` abort `fetch /v1/hooks`（`hangChat`）。`waitForTurnStart` 之后 `ac.abort()`。再 `GET /v1/sessions/s-abort`，events 含 `turn/end` 且 `status === "cancelled"`。不要断言被 abort 的 fetch 的 HTTP 状态。

`awaiting_action` 期间 hooks 409：假 chat 第一步 `a2ui_emit`（messages 复制 `packages/loop/tests/run-turn.test.ts` 的 `confirmMessages`），`channel` 由 `/v1/turns` 固定为 host。`await fetch /v1/turns` 直到结束（`res.text()` 读完 SSE）。然后 hooks 同一 `sessionId` 期望 409。

- [ ] **Step 2: Extend factory scan in `server.test.ts`**

在现有 `host src does not import tool factories` 里追加：

```ts
    expect(src).not.toMatch(/@flintloom\/channel-webhook/);
    expect(src).not.toMatch(/createWebhookAdapter/);
    expect(src).not.toMatch(/lastAssistantText/);
```

不要禁止 `@flintloom/channel`。

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm exec vitest run apps/host/tests/webhook.test.ts`

Expected: FAIL（404，还没有路由 / ASSEMBLY 还没有插件）

- [ ] **Step 4: Implement route + assembly**

`parseHookBody` 放在 `server.ts` 的 `parseTurnBody` 旁。`POST && pathname === "/v1/hooks"` 放在 `POST /v1/turns` **之前或之后均可**，但必须在最终 `send(res, 404)` 之前。

`import type { ChannelRegistry } from "@flintloom/channel";`

`apps/host/package.json` 加依赖。`flintloom.yml` 与 `ASSEMBLY` 追加两行。`pnpm install`。

GET `/v1/hooks` 不要特判，自然 404。

- [ ] **Step 5: Run webhook + server + a2ui tests**

Run: `pnpm exec vitest run apps/host/tests/webhook.test.ts apps/host/tests/server.test.ts apps/host/tests/a2ui.test.ts`

Expected: PASS

- [ ] **Step 6: Typecheck and full suite**

Run: `pnpm typecheck`

Expected: PASS

Run: `pnpm test`

Expected: 全部 PASS。不打真实模型 HTTP（假 chat + `setDefault`）。

确认 `apps/host/src` 无 `channel-webhook` / `createWebhookAdapter` / `lastAssistantText`。确认 `packages/channel/src` 无这两个名字。

- [ ] **Step 7: Commit**

```bash
git add apps/host/src/server.ts apps/host/package.json apps/host/tests/webhook.test.ts apps/host/tests/server.test.ts apps/host/tests/assembly.ts flintloom.yml package.json pnpm-lock.yaml
git commit -m "feat: accept loopback webhook turns on POST /v1/hooks"
```

不要 add `scripts/desktop-dev.ts` 或 `check_libs.py`。

---

## Spec coverage

| Spec | Task |
|---|---|
| `ChannelRegistry` `has` / `register` / `inbound`；重复 id / 未知 id throw | 1 |
| `provide("channels")`；无 `send` | 1 |
| 根 `package.json` `@flintloom/channel` | 1 |
| `lastAssistantText` 按 turnId 切片；忽略 chunk / model/error | 2 |
| `createWebhookAdapter`：`channel: "webhook"`、无 `onEvent` | 2 |
| `apply` `effect(register("webhook"))`；stop 后 `has` false | 2 |
| 同一 `text`、无 wait 的事件同构 | 2 |
| `channel: "webhook"` + a2ui wait → `status === "ok"` 且 `turn/end` | 3 |
| 不改 `channel === "host"` 判断 | 3 |
| `startHost.runtime`；turns/actions/hooks 将共用的 busy 先落地在 turns+actions | 4 |
| `/v1/turns` 进行中第二条 409（现网收紧） | 4 |
| `POST /v1/hooks` drain → 404/400/409 → inbound → JSON 键顺序 | 5 |
| trim `text`；默认 session `"webhook"` | 5 |
| 省略插件 401/404；cancel 对 in-flight webhook 404 | 5 |
| 断开 hooks → session `cancelled` | 5 |
| turns 挂起时 hooks 409；`awaiting_action` 时 hooks 409 | 5 |
| factory 扫描；yml / ASSEMBLY；host 依赖 `@flintloom/channel` | 5 |
| 不登记 webhook 到 `controllers`/`turns` | 5 |
| 不改 desktop / DocForge / CLI 入站 | 全任务都不碰那些文件 |
