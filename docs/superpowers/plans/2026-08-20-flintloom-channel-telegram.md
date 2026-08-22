# FlintLoom Telegram channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** yml 挂上 `@flintloom/channel-telegram` 且仅 `startHost` overlay `poll: true` 时，对白名单 chat 的纯文本走 `inbound("telegram")` + `sendMessage`；CLI 不轮询；与工作台共用 `turnBusy`。

**Architecture:** `@flintloom/channel` 登记表已有。新包 `@flintloom/channel-telegram` `apply` 登记 `"telegram"` 适配器（`runTurn({ channel: "telegram" })`，无 `onEvent`）。Poller 在插件 effect 里：先 `deleteWebhook({ drop_pending_updates: true })`，再 `getUpdates`。Host 只 overlay `{ workspaceRoot, poll: true }` 并提供 `turnBusy` / `Runtime.stop`；**禁止** import 本包，禁止为 telegram 调 `runTurn`。默认 yml **不加** telegram 行。

**Tech Stack:** 现有 kernel `apply` / `provide` / `effect` / `require`，`@flintloom/channel` `inbound`，`@flintloom/loop` `runTurn`，全局 `fetch`（测试注入 `apiFetch`）。不新增第三方 npm 包。不打 `api.telegram.org`。

## Global Constraints

- 产品名 FlintLoom；包前缀 `@flintloom/*`；只绑 `127.0.0.1`。
- 不 import / submodule / 拷贝 dataagent-v3、deepseek-harness、Cordis。不引入 grammy / telegraf。
- 禁止往 `createRuntime` 里 `register`。Host 不新增 HTTP 路由。
- `apps/host/src` 不得出现 `@flintloom/channel-telegram`、`createTelegramAdapter`。允许 `import type` `@flintloom/channel`。允许字符串 `"channel-telegram"` 作为 overlay id。不要用正则禁止单词 `telegram` 或 `poll`。
- loop 保持 `if (channel === "host" && stepWait)`，不要改成 `channel !== "cli"`。
- telegram turn **不**写入 `controllers` / `turns`。本片不实现 `channels.send`。
- token 不得进入 `Error.message`、session 事件、日志。fetch 失败 catch 后只抛固定短语 `deleteWebhook` / `getUpdates` / `sendMessage`。
- 凡 `startHost` 后会跑 `runTurn` 的用例：`registerChat` 之后必须 `setDefault("chat", 假 id)`。
- 仓库根 `flintloom.yml` 与 `ASSEMBLY` **不**加 `channel-telegram` 行。
- Windows：指定文件 `git add`；不要 `git add -A`。不要提交 `check_libs.py`、`scripts/desktop-dev.ts`。PowerShell 用 `git commit -m @"` / `"@`，不要 bash heredoc 的 `EOF` 行。
- Spec：`docs/superpowers/specs/2026-08-20-flintloom-channel-telegram-design.md`

## File map

```text
packages/channel-telegram/package.json
packages/channel-telegram/src/config.ts     # parseTelegramConfig
packages/channel-telegram/src/text.ts       # lastAssistantText（本包副本）
packages/channel-telegram/src/waiting.ts    # sessionHasWaitingTurn（本包副本）
packages/channel-telegram/src/adapter.ts    # createTelegramAdapter
packages/channel-telegram/src/poller.ts     # startTelegramPoller
packages/channel-telegram/src/plugin.ts
packages/channel-telegram/src/index.ts
packages/channel-telegram/tests/config.test.ts
packages/channel-telegram/tests/text.test.ts
packages/channel-telegram/tests/adapter.test.ts
packages/channel-telegram/tests/isomorphism.test.ts
packages/channel-telegram/tests/poller.test.ts

packages/loop/tests/run-turn.test.ts        # channel: "telegram" 不暂停

apps/host/src/server.ts                     # turnBusy、Runtime.stop、pollChannels overlay、close
apps/cli/src/bin.ts                         # stop() 在 formatCliOutput 之后
apps/host/tests/server.test.ts              # turnBusy、stop、factory scan
apps/host/tests/webhook.test.ts             # factory scan 增禁 telegram 包名
apps/host/tests/telegram.test.ts            # overlay poll、CLI 两参不 poll、close 停 fetch

package.json                                # 根 devDependencies @flintloom/channel-telegram
pnpm-lock.yaml
```

不改 desktop UI、DocForge、`models-chat`、`flintloom.yml` 默认插件列表、`ASSEMBLY`、`packages/channel` 的 API 形状。

---

### Task 1: `turnBusy` + `Runtime.stop`

**Files:**
- Modify: `apps/host/src/server.ts`
- Modify: `apps/cli/src/bin.ts`
- Modify: `apps/host/tests/server.test.ts`
- Test: `apps/host/tests/server.test.ts`（追加用例；现有 webhook 409 必须保持绿）

**Interfaces:**
- Consumes: `applyConfig` 返回的 `Disposer`；现有 `handleRequest` 的 `opts.busy`
- Produces:

```ts
export type Runtime = { ctx: Context; stop: () => void };

export async function createRuntime(
  workspaceRoot: string,
  homeDir: string,
): Promise<Runtime>;
```

服务键字面量 `"turnBusy"`，值 `Set<string>`（sessionId）。本任务 **还不** 加 `pollChannels` overlay，**还不** 建 telegram 包。

- [ ] **Step 1: Write the failing test**

在 `apps/host/tests/server.test.ts` 现有 `describe` 里追加（保留文件顶部已有 import：`createRuntime`、`startHost`、`loadOrCreateToken`、`writeAssembly`、`mkdtempSync`、`afterEach`）：

```ts
it("createRuntime provides turnBusy and stop disposes plugins", async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-runtime-stop-"));
  const homeDir = mkdtempSync(join(tmpdir(), "flintloom-runtime-stop-home-"));
  writeAssembly(workspaceRoot);
  const { ctx, stop } = await createRuntime(workspaceRoot, homeDir);
  expect(ctx.require("turnBusy")).toBeInstanceOf(Set);
  expect(typeof stop).toBe("function");
  stop();
  expect(() => ctx.require("sessions")).toThrow(/sessions/);
});

it("startHost HTTP busy is the ctx turnBusy set", async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-turnbusy-"));
  const homeDir = mkdtempSync(join(tmpdir(), "flintloom-turnbusy-home-"));
  writeAssembly(workspaceRoot);
  const host = await startHost({ workspaceRoot, homeDir, port: 0 });
  close = host.close;
  const token = loadOrCreateToken(homeDir);
  const busy = host.runtime.ctx.require<Set<string>>("turnBusy");
  busy.add("webhook");
  const res = await fetch(`${host.url}/v1/hooks`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: "hi" }),
  });
  expect(res.status).toBe(409);
});
```

若该文件没有 `let close: (() => Promise<void>) | undefined` 与 `afterEach` 里 `await close?.()`，按文件现有 afterEach 模式挂上，不要另起一套泄漏 host。

在同一文件的 factory scan 用例 **本任务不要** 加 telegram 字符串。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run apps/host/tests/server.test.ts -t "provides turnBusy"`

Expected: FAIL（`stop` 不是函数，或 `require("turnBusy")` throw）

- [ ] **Step 3: Write minimal implementation**

`apps/host/src/server.ts`：

把

```ts
export type Runtime = { ctx: Context };
```

改成

```ts
export type Runtime = { ctx: Context; stop: () => void };
```

`createRuntime` 在 `const ctx = new Context();` 之后、`applyConfig` 之前：

```ts
ctx.provide("turnBusy", new Set<string>());
const stop = await applyConfig(ctx, config, { runtimeConfigById });
return { ctx, stop };
```

删掉原来的 `await applyConfig(...); return { ctx };`。

`startHost`：删掉 `const busy = new Set<string>();`。在 `const runtime = await createRuntime(...)` 之后：

```ts
const busy = runtime.ctx.require<Set<string>>("turnBusy");
```

`close` 改成：

```ts
close: () =>
  new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    runtime.stop();
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  }),
```

`apps/cli/src/bin.ts`：必须先 `formatCliOutput`，再 `stop()`，再写 stdout（`stop` 会 dispose session store）：

```ts
const { workspace, text } = parseArgv(process.argv.slice(2));
const { ctx, stop } = await createRuntime(workspace, homedir());
const session = ctx.require<SessionStore>("sessions").getOrCreate("cli");
const { status } = await ctx.require<LoopService>("loop").runTurn({
  ctx,
  session,
  text,
  workspaceRoot: workspace,
  channel: "cli",
  signal: new AbortController().signal,
});

const output = formatCliOutput(session.events(), status);
stop();
if (output.stdout !== "") {
  process.stdout.write(output.stdout);
}
if (output.stderr !== "") {
  process.stderr.write(output.stderr);
}

process.exit(status === "ok" ? 0 : 1);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run apps/host/tests/server.test.ts apps/host/tests/webhook.test.ts apps/cli`

Expected: PASS

- [ ] **Step 5: Commit**

```powershell
git add apps/host/src/server.ts apps/cli/src/bin.ts apps/host/tests/server.test.ts
git commit -m @"
feat: share host turnBusy on ctx and dispose runtime on close
"@
```

---

### Task 2: `@flintloom/channel-telegram` 适配器

**Files:**
- Create: `packages/channel-telegram/package.json`
- Create: `packages/channel-telegram/src/config.ts`
- Create: `packages/channel-telegram/src/text.ts`
- Create: `packages/channel-telegram/src/adapter.ts`
- Create: `packages/channel-telegram/src/plugin.ts`
- Create: `packages/channel-telegram/src/index.ts`
- Create: `packages/channel-telegram/tests/config.test.ts`
- Create: `packages/channel-telegram/tests/text.test.ts`
- Create: `packages/channel-telegram/tests/adapter.test.ts`
- Create: `packages/channel-telegram/tests/isomorphism.test.ts`
- Modify: `package.json`（根 `devDependencies` 增加 `"@flintloom/channel-telegram": "workspace:*"`，放在 `@flintloom/channel-webhook` 与 `@flintloom/docforge` 之间按字母序）
- Modify: `pnpm-lock.yaml`（根目录 `pnpm install` 若有 diff 则纳入）

**Interfaces:**
- Consumes: `ChannelAdapter` / `ChannelRegistry`；`LoopService.runTurn`；`SessionStore.getOrCreate`
- Produces:

```ts
export type TelegramConfig = {
  token: string;
  allowedChatIds: Set<string>;
  poll: boolean;
  workspaceRoot: string | undefined;
  apiFetch: typeof fetch;
};

export function parseTelegramConfig(config: Record<string, unknown>): TelegramConfig;

export function lastAssistantText(
  events: readonly SessionEvent[],
  turnId: string,
): string;

export function createTelegramAdapter(ctx: Context): ChannelAdapter;
```

插件 `name: "@flintloom/channel-telegram"`。`register` id 字面量 `"telegram"`。本任务 **没有** poller，`poll === true` 时 `apply` 仍只登记适配器并 `require("turnBusy")`，**不** 调 `startTelegramPoller`（该函数 Task 4 才存在）。若 `poll === true` 且缺 `turnBusy` → `require` 抛错，message 含 `turnBusy`。

**禁止**从 `@flintloom/channel-webhook` import。`packages/channel` 不得出现 `lastAssistantText` / `createTelegramAdapter`。

- [ ] **Step 1: Write the failing tests**

`packages/channel-telegram/tests/config.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { parseTelegramConfig } from "../src/config.ts";

describe("parseTelegramConfig", () => {
  it("throws token or allowedChatIds or workspaceRoot", () => {
    expect(() => parseTelegramConfig({})).toThrow(/token/);
    expect(() => parseTelegramConfig({ token: "" })).toThrow(/token/);
    expect(() => parseTelegramConfig({ token: "tok" })).toThrow(/allowedChatIds/);
    expect(() => parseTelegramConfig({ token: "tok", allowedChatIds: [] })).toThrow(
      /allowedChatIds/,
    );
    expect(() =>
      parseTelegramConfig({ token: "tok", allowedChatIds: [{}] }),
    ).toThrow(/allowedChatIds/);
    expect(() =>
      parseTelegramConfig({
        token: "tok",
        allowedChatIds: [1],
        poll: true,
      }),
    ).toThrow(/workspaceRoot/);
  });

  it("accepts number and decimal string chat ids without polling", () => {
    const parsed = parseTelegramConfig({
      token: "tok",
      allowedChatIds: [123, "-100123"],
    });
    expect(parsed.token).toBe("tok");
    expect(parsed.poll).toBe(false);
    expect(parsed.workspaceRoot).toBeUndefined();
    expect(parsed.allowedChatIds.has("123")).toBe(true);
    expect(parsed.allowedChatIds.has("-100123")).toBe(true);
    expect(parsed.apiFetch).toBe(globalThis.fetch);
  });
});
```

`packages/channel-telegram/tests/text.test.ts`：与 `packages/channel-webhook/tests/text.test.ts` 相同断言，只改 import 路径为 `../src/text.ts`。

`packages/channel-telegram/tests/adapter.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { Context } from "@flintloom/kernel";
import type { LoopService, RunTurnInput } from "@flintloom/loop";
import sessionPlugin from "@flintloom/session";
import channelPlugin, { type ChannelRegistry } from "@flintloom/channel";
import telegramPlugin, { createTelegramAdapter } from "../src/index.ts";

describe("createTelegramAdapter", () => {
  it("calls runTurn with channel telegram and no onEvent", async () => {
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
    const adapter = createTelegramAdapter(ctx);
    const result = await adapter.inbound({
      text: "hi",
      sessionId: "telegram:1",
      workspaceRoot: "/tmp",
      signal: new AbortController().signal,
    });
    expect(captured?.channel).toBe("telegram");
    expect(captured?.onEvent).toBeUndefined();
    expect(captured?.session.id).toBe("telegram:1");
    expect(result).toEqual({ turnId: "t1", status: "ok", text: "hello" });
  });

  it("apply registers telegram and stop unregisters", () => {
    const ctx = new Context();
    ctx.plugin(sessionPlugin);
    ctx.provide("loop", {
      runTurn: async () => ({ turnId: "t", status: "ok" as const }),
      continueTurn: async () => ({ turnId: "t", status: "ok" as const }),
    });
    ctx.plugin(channelPlugin);
    const stop = ctx.plugin(telegramPlugin, {
      token: "tok",
      allowedChatIds: [1],
    });
    const channels = ctx.require<ChannelRegistry>("channels");
    expect(channels.has("telegram")).toBe(true);
    stop();
    expect(channels.has("telegram")).toBe(false);
  });
});
```

`packages/channel-telegram/tests/isomorphism.test.ts`：复制 `packages/channel-webhook/tests/isomorphism.test.ts`，把 webhook 全部换成 telegram：

- import `telegramPlugin from "../src/index.ts"`
- `ctx.plugin(telegramPlugin, { token: "tok", allowedChatIds: [1] })`
- `inbound("telegram", { … sessionId: "tg" … })`
- `sessions.get("tg")`
- `channel: "host"` 对照不变
- describe 名 `telegram inbound events`

- [ ] **Step 2: Run tests to verify they fail**

根目录先把包名写入 `package.json` 并 `pnpm install`（否则 import 解析失败，那不是本任务要的红）。然后：

Run: `pnpm exec vitest run packages/channel-telegram/tests`

Expected: FAIL（`parseTelegramConfig` / `createTelegramAdapter` 未定义）

- [ ] **Step 3: Write minimal implementation**

`packages/channel-telegram/package.json`：

```json
{
  "name": "@flintloom/channel-telegram",
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

`packages/channel-telegram/src/config.ts`：

```ts
export type TelegramConfig = {
  token: string;
  allowedChatIds: Set<string>;
  poll: boolean;
  workspaceRoot: string | undefined;
  apiFetch: typeof fetch;
};

function chatIdKey(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return String(value);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    const n = Number(value);
    if (Number.isSafeInteger(n)) {
      return String(n);
    }
  }
  return undefined;
}

export function parseTelegramConfig(config: Record<string, unknown>): TelegramConfig {
  if (typeof config.token !== "string" || config.token.length === 0) {
    throw new Error("token");
  }
  if (!Array.isArray(config.allowedChatIds) || config.allowedChatIds.length === 0) {
    throw new Error("allowedChatIds");
  }
  const allowedChatIds = new Set<string>();
  for (const item of config.allowedChatIds) {
    const key = chatIdKey(item);
    if (key === undefined) {
      throw new Error("allowedChatIds");
    }
    allowedChatIds.add(key);
  }
  const poll = config.poll === true;
  const workspaceRoot =
    typeof config.workspaceRoot === "string" && config.workspaceRoot.length > 0
      ? config.workspaceRoot
      : undefined;
  if (poll && workspaceRoot === undefined) {
    throw new Error("workspaceRoot");
  }
  const apiFetch =
    typeof config.apiFetch === "function"
      ? (config.apiFetch as typeof fetch)
      : globalThis.fetch;
  return {
    token: config.token,
    allowedChatIds,
    poll,
    workspaceRoot,
    apiFetch,
  };
}
```

`packages/channel-telegram/src/text.ts`：逐字复制 `packages/channel-webhook/src/text.ts`（同一 `lastAssistantText`）。

`packages/channel-telegram/src/adapter.ts`：复制 `packages/channel-webhook/src/adapter.ts`，把 `"webhook"` 换成 `"telegram"`，函数名 `createTelegramAdapter`，import `./text.ts`。

`packages/channel-telegram/src/plugin.ts`：

```ts
import type { Context, FlintPlugin } from "@flintloom/kernel";
import type { ChannelRegistry } from "@flintloom/channel";
import { createTelegramAdapter } from "./adapter.ts";
import { parseTelegramConfig } from "./config.ts";

const plugin: FlintPlugin = {
  name: "@flintloom/channel-telegram",
  apply(ctx: Context, config: Record<string, unknown>) {
    const channels = ctx.require<ChannelRegistry>("channels");
    ctx.require("sessions");
    ctx.require("loop");
    const parsed = parseTelegramConfig(config);
    ctx.effect(channels.register("telegram", createTelegramAdapter(ctx)));
    if (parsed.poll) {
      ctx.require<Set<string>>("turnBusy");
    }
  },
};

export default plugin;
```

`packages/channel-telegram/src/index.ts`：

```ts
export { parseTelegramConfig } from "./config.ts";
export { lastAssistantText } from "./text.ts";
export { createTelegramAdapter } from "./adapter.ts";
export { default } from "./plugin.ts";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run packages/channel-telegram/tests`

Expected: PASS

- [ ] **Step 5: Commit**

```powershell
git add packages/channel-telegram package.json pnpm-lock.yaml
git commit -m @"
feat: add telegram channel adapter and lastAssistantText
"@
```

---

### Task 3: loop `channel: "telegram"` 不暂停

**Files:**
- Modify: `packages/loop/tests/run-turn.test.ts`
- 不修改 `packages/loop/src/run-turn.ts` 的 `channel === "host"` 判断，除非测试意外 FAIL（那时只改测试，不改条件）

**Interfaces:**
- Consumes: 现有 `confirmMessages()` 夹具与 webhook 用例
- Produces: 一条 `it("does not pause a2ui wait on telegram channel", …)`，断言 `status === "ok"` 且有 `turn/end`

- [ ] **Step 1: Write the failing test**

紧挨现有 `does not pause a2ui wait on webhook channel` 之后追加。假 chat 第二步文本用 `"telegram-skip-wait"`。`channel: "telegram"`。`Session("s-telegram")`。

完整用例：

```ts
  it("does not pause a2ui wait on telegram channel", async () => {
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
          yield { type: "text", text: "telegram-skip-wait" };
        }
      },
    };
    const ctx = boot();
    ctx.plugin(a2uiPlugin);
    ctx.require<ModelRegistry>("models").registerChat("fake", fakeChat);
    ctx.require<ModelRegistry>("models").setDefault("chat", "fake");
    const session = new Session("s-telegram");
    const result = await runTurn({
      ctx,
      session,
      text: "emit",
      workspaceRoot: process.cwd(),
      channel: "telegram",
      signal: new AbortController().signal,
    });
    expect(result.status).toBe("ok");
    expect(session.events().some((e) => e.type === "turn/end")).toBe(true);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/loop/tests/run-turn.test.ts -t "telegram channel"`

Expected: **PASS**（现有判断已是 `channel === "host"`）。若 PASS，不要改 `run-turn.ts`。若 FAIL 成 `awaiting_action`，只检查测试夹具是否漏了 `a2uiPlugin` / `setDefault`，仍然 **不要** 把条件改成 `channel !== "cli"`。

- [ ] **Step 3: No production change unless FAIL**

保持：

```ts
if (channel === "host" && stepWait) {
```

- [ ] **Step 4: Run the file**

Run: `pnpm exec vitest run packages/loop/tests/run-turn.test.ts`

Expected: PASS（含 host 暂停、cli / webhook / telegram 不暂停）

- [ ] **Step 5: Commit**

```powershell
git add packages/loop/tests/run-turn.test.ts
git commit -m @"
test: telegram channel does not pause a2ui wait
"@
```

---

### Task 4: Telegram poller

**Files:**
- Create: `packages/channel-telegram/src/waiting.ts`
- Create: `packages/channel-telegram/src/poller.ts`
- Create: `packages/channel-telegram/tests/poller.test.ts`
- Modify: `packages/channel-telegram/src/plugin.ts`
- Modify: `packages/channel-telegram/src/index.ts`

**Interfaces:**
- Consumes: `TelegramConfig`；`ctx.require("channels" | "sessions" | "turnBusy")`；`parsed.apiFetch`
- Produces:

```ts
export function startTelegramPoller(ctx: Context, parsed: TelegramConfig): () => void;
```

返回的 disposer 必须 `abort`。Bot URL 形如 `https://api.telegram.org/bot${token}/deleteWebhook`（token 仅出现在 URL 路径，不要写进 Error.message）。

- [ ] **Step 1: Write the failing test**

`packages/channel-telegram/tests/poller.test.ts`：

```ts
import { afterEach, describe, expect, it } from "vitest";
import { Context } from "@flintloom/kernel";
import channelPlugin, { type ChannelRegistry } from "@flintloom/channel";
import sessionPlugin, { type SessionStore } from "@flintloom/session";
import type { LoopService, RunTurnInput } from "@flintloom/loop";
import { parseTelegramConfig } from "../src/config.ts";
import { startTelegramPoller } from "../src/poller.ts";

type Call = { url: string; body: unknown };

function jsonOk(result: unknown): Response {
  return new Response(JSON.stringify({ ok: true, result }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function boot(runTurn: LoopService["runTurn"]) {
  const ctx = new Context();
  ctx.provide("turnBusy", new Set<string>());
  ctx.plugin(sessionPlugin);
  ctx.plugin(channelPlugin);
  ctx.provide("loop", {
    runTurn,
    continueTurn: async () => ({ turnId: "t", status: "ok" as const }),
  });
  ctx.require<ChannelRegistry>("channels").register("telegram", {
    async inbound(input) {
      return ctx.require<LoopService>("loop").runTurn({
        ctx,
        session: ctx.require<SessionStore>("sessions").getOrCreate(input.sessionId),
        text: input.text,
        workspaceRoot: input.workspaceRoot,
        channel: "telegram",
        signal: input.signal,
      }).then((r) => ({ turnId: r.turnId, status: r.status, text: "reply-text" }));
    },
  });
  return ctx;
}

describe("startTelegramPoller", () => {
  const stops: Array<() => void> = [];
  afterEach(() => {
    for (const stop of stops.splice(0)) stop();
  });

  it("deleteWebhook before getUpdates then replies to allowlisted text", async () => {
    const calls: Call[] = [];
    const inboundTexts: string[] = [];
    const ctx = boot(async (input: RunTurnInput) => {
      inboundTexts.push(input.text);
      input.session.append({ type: "turn/start", turnId: "t1" });
      return { turnId: "t1", status: "ok" };
    });
    let updates = 0;
    const apiFetch: typeof fetch = async (url, init) => {
      const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
      calls.push({ url: String(url), body });
      if (String(url).includes("deleteWebhook")) {
        return jsonOk(true);
      }
      if (String(url).includes("getUpdates")) {
        updates += 1;
        if (updates === 1) {
          return jsonOk([
            {
              update_id: 10,
              message: { chat: { id: 99 }, text: "nope" },
            },
            {
              update_id: 11,
              message: { chat: { id: 123 }, text: "  hi  " },
            },
          ]);
        }
        await new Promise<void>((_resolve, reject) => {
          const signal = init?.signal;
          const onAbort = () => reject(new DOMException("aborted", "AbortError"));
          if (signal?.aborted) {
            onAbort();
            return;
          }
          signal?.addEventListener("abort", onAbort, { once: true });
        });
      }
      if (String(url).includes("sendMessage")) {
        return jsonOk({ message_id: 1 });
      }
      return jsonOk([]);
    };
    const parsed = parseTelegramConfig({
      token: "tok",
      allowedChatIds: [123],
      poll: true,
      workspaceRoot: "/ws",
      apiFetch,
    });
    stops.push(startTelegramPoller(ctx, parsed));
    await vi.waitFor(() => {
      expect(calls.some((c) => c.url.endsWith("/sendMessage"))).toBe(true);
    });
    expect(calls[0]?.url).toBe("https://api.telegram.org/bottok/deleteWebhook");
    expect(calls[0]?.body).toEqual({ drop_pending_updates: true });
    expect(calls.find((c) => c.url.endsWith("/getUpdates"))).toBeTruthy();
    const getIdx = calls.findIndex((c) => c.url.endsWith("/getUpdates"));
    expect(getIdx).toBeGreaterThan(0);
    expect(inboundTexts).toEqual(["hi"]);
    const sent = calls.find((c) => c.url.endsWith("/sendMessage"));
    expect(sent?.body).toEqual({ chat_id: 123, text: "reply-text" });
  });

  it("skips when turnBusy already has the session", async () => {
    const inboundTexts: string[] = [];
    const ctx = boot(async (input: RunTurnInput) => {
      inboundTexts.push(input.text);
      return { turnId: "t1", status: "ok" };
    });
    ctx.require<Set<string>>("turnBusy").add("telegram:123");
    let updates = 0;
    const apiFetch: typeof fetch = async (url, init) => {
      if (String(url).includes("deleteWebhook")) return jsonOk(true);
      if (String(url).includes("getUpdates")) {
        updates += 1;
        if (updates === 1) {
          return jsonOk([
            { update_id: 1, message: { chat: { id: 123 }, text: "hi" } },
          ]);
        }
        await new Promise<void>((_resolve, reject) => {
          const signal = init?.signal;
          const onAbort = () => reject(new DOMException("aborted", "AbortError"));
          if (signal?.aborted) {
            onAbort();
            return;
          }
          signal?.addEventListener("abort", onAbort, { once: true });
        });
      }
      return jsonOk([]);
    };
    stops.push(
      startTelegramPoller(
        ctx,
        parseTelegramConfig({
          token: "tok",
          allowedChatIds: [123],
          poll: true,
          workspaceRoot: "/ws",
          apiFetch,
        }),
      ),
    );
    await vi.waitFor(() => {
      expect(updates).toBeGreaterThan(1);
    });
    expect(inboundTexts).toEqual([]);
  });
});
```

在文件顶部补：`import { afterEach, describe, expect, it, vi } from "vitest";`（上面片段若拆了 import，合并成这一行）。

再追加两个 `it`（同一 `describe`）：

1. `does not sendMessage when inbound text is empty`：`runTurn` 返回后让适配器式 inbound 返回 `{ text: "" }`（把 `boot` 里写死的 `"reply-text"` 改成可注入：给 `boot` 增加参数 `reply = "reply-text"`）。`reply: ""` 时 `calls` 不得含 `sendMessage`。
2. `truncates sendMessage text to 4096`：`reply` 为 `"a".repeat(4097)`，断言 sendMessage body.text 长度 4096。

空回复 / 截断：不要复制整份 `boot`，把 `boot(runTurn, replyText = "reply-text")` 的 inbound `text: replyText`。

再追加 `it("skips inbound when session is awaiting_action", …)`：在 `startTelegramPoller` 之前对 `sessions.getOrCreate("telegram:123")` 写入与 host `waitingSession` 相同的 `turn/start` + `a2ui/surface`（`wait: true`，见 `apps/host/tests/a2ui.test.ts` 的 `waitingSession`）。断言 `inboundTexts` 为空。

再追加 `it("retries deleteWebhook and never getUpdates while it fails", …)`：`apiFetch` 对 deleteWebhook 返回 `{ ok: false }`；`vi.useFakeTimers()`；`await vi.advanceTimersByTimeAsync(1000)` 至少一次；断言所有 `calls.url` 含 `deleteWebhook`、不含 `getUpdates`。`afterEach` 里 `vi.useRealTimers()`。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/channel-telegram/tests/poller.test.ts`

Expected: FAIL（`startTelegramPoller` 未导出）

- [ ] **Step 3: Write minimal implementation**

`packages/channel-telegram/src/waiting.ts`：

```ts
import type { Session } from "@flintloom/session";

export function sessionHasWaitingTurn(session: Session): boolean {
  const ids = new Set<string>();
  for (const event of session.events()) {
    if (event.type === "turn/start") {
      ids.add(event.turnId);
    }
  }
  for (const turnId of ids) {
    if (session.isWaiting(turnId)) {
      return true;
    }
  }
  return false;
}
```

`packages/channel-telegram/src/poller.ts`：

```ts
import type { Context } from "@flintloom/kernel";
import type { ChannelRegistry } from "@flintloom/channel";
import type { SessionStore } from "@flintloom/session";
import type { TelegramConfig } from "./config.ts";
import { sessionHasWaitingTurn } from "./waiting.ts";

function isAbort(signal: AbortSignal, err: unknown): boolean {
  return signal.aborted || (err instanceof Error && err.name === "AbortError");
}

export function startTelegramPoller(ctx: Context, parsed: TelegramConfig): () => void {
  const ac = new AbortController();
  void runTelegramLoop(ctx, parsed, ac.signal);
  return () => {
    ac.abort();
  };
}

async function delay(signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, 1000);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function botPost(
  parsed: TelegramConfig,
  method: string,
  body: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  try {
    const res = await parsed.apiFetch(`https://api.telegram.org/bot${parsed.token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      throw new Error(method);
    }
    const json: unknown = await res.json();
    if (
      json === null ||
      typeof json !== "object" ||
      !("ok" in json) ||
      (json as { ok: unknown }).ok !== true
    ) {
      throw new Error(method);
    }
    return json;
  } catch (err) {
    if (isAbort(signal, err)) {
      throw err;
    }
    throw new Error(method);
  }
}

async function runTelegramLoop(
  ctx: Context,
  parsed: TelegramConfig,
  signal: AbortSignal,
): Promise<void> {
  let cleared = false;
  let offset = 0;
  const workspaceRoot = parsed.workspaceRoot;
  if (workspaceRoot === undefined) {
    return;
  }
  while (!signal.aborted) {
    try {
      if (!cleared) {
        await botPost(parsed, "deleteWebhook", { drop_pending_updates: true }, signal);
        cleared = true;
        continue;
      }
      const json = (await botPost(
        parsed,
        "getUpdates",
        { offset, timeout: 30, allowed_updates: ["message"] },
        signal,
      )) as { result?: unknown };
      const result = json.result;
      if (!Array.isArray(result)) {
        throw new Error("getUpdates");
      }
      const bad = result.some((item) => {
        if (item === null || typeof item !== "object" || !("update_id" in item)) {
          return true;
        }
        const id = (item as { update_id: unknown }).update_id;
        return typeof id !== "number" || !Number.isInteger(id) || !Number.isFinite(id);
      });
      if (bad) {
        throw new Error("getUpdates");
      }
      const channels = ctx.require<ChannelRegistry>("channels");
      const sessions = ctx.require<SessionStore>("sessions");
      const busy = ctx.require<Set<string>>("turnBusy");
      for (const item of result) {
        const update = item as {
          update_id: number;
          message?: { chat?: { id?: unknown }; text?: unknown };
        };
        offset = update.update_id + 1;
        const chatId = update.message?.chat?.id;
        if (typeof chatId !== "number" || !Number.isSafeInteger(chatId)) {
          continue;
        }
        const chatKey = String(chatId);
        if (!parsed.allowedChatIds.has(chatKey)) {
          continue;
        }
        if (typeof update.message?.text !== "string") {
          continue;
        }
        const text = update.message.text.trim();
        if (text.length === 0) {
          continue;
        }
        const sessionId = `telegram:${chatKey}`;
        const session = sessions.getOrCreate(sessionId);
        if (busy.has(sessionId) || sessionHasWaitingTurn(session)) {
          continue;
        }
        busy.add(sessionId);
        void runInboundThenReply({
          channels,
          busy,
          parsed,
          chatId,
          sessionId,
          text,
          workspaceRoot,
          signal,
        });
      }
    } catch (err) {
      if (isAbort(signal, err)) {
        return;
      }
      try {
        await delay(signal);
      } catch {
        return;
      }
    }
  }
}

async function runInboundThenReply(opts: {
  channels: ChannelRegistry;
  busy: Set<string>;
  parsed: TelegramConfig;
  chatId: number;
  sessionId: string;
  text: string;
  workspaceRoot: string;
  signal: AbortSignal;
}): Promise<void> {
  try {
    const result = await opts.channels.inbound("telegram", {
      text: opts.text,
      sessionId: opts.sessionId,
      workspaceRoot: opts.workspaceRoot,
      signal: opts.signal,
    });
    if (opts.signal.aborted) {
      return;
    }
    if (result.text.length === 0) {
      return;
    }
    const out = result.text.length > 4096 ? result.text.slice(0, 4096) : result.text;
    await botPost(opts.parsed, "sendMessage", { chat_id: opts.chatId, text: out }, opts.signal);
  } catch (err) {
    if (isAbort(opts.signal, err)) {
      return;
    }
  } finally {
    opts.busy.delete(opts.sessionId);
  }
}
```

`plugin.ts` 的 `if (parsed.poll)` 改为：

```ts
    if (parsed.poll) {
      ctx.require<Set<string>>("turnBusy");
      ctx.effect(startTelegramPoller(ctx, parsed));
    }
```

并 `import { startTelegramPoller } from "./poller.ts";`。

`index.ts` 增加：`export { startTelegramPoller } from "./poller.ts";`

注意：`deleteWebhook` 成功后 `continue` 立刻 `getUpdates`，不要在清队列后再 delay。

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run packages/channel-telegram/tests`

Expected: PASS

若 `vi.waitFor` 超时：检查 mock 是否没挂住第二次 `getUpdates`（不停返回同一 batch 会重复 inbound）。第一次 batch 之后必须挂起直到 abort。

- [ ] **Step 5: Commit**

```powershell
git add packages/channel-telegram
git commit -m @"
feat: poll Telegram updates and reply with sendMessage
"@
```

---

### Task 5: `pollChannels` overlay + host 验收

**Files:**
- Modify: `apps/host/src/server.ts`（`createRuntime` 第三参；`startHost` 传 `{ pollChannels: true }`）
- Create: `apps/host/tests/telegram.test.ts`
- Modify: `apps/host/tests/server.test.ts`（factory scan 增加 telegram 禁 import）
- Modify: `apps/host/tests/webhook.test.ts`（同样 factory scan）
- 不修改 `flintloom.yml`、`apps/host/tests/assembly.ts`

**Interfaces:**
- Consumes: Task 1 的 `Runtime.stop` / `turnBusy`；yml 行 `id: "channel-telegram"`
- Produces:

```ts
export async function createRuntime(
  workspaceRoot: string,
  homeDir: string,
  opts?: { pollChannels?: boolean },
): Promise<Runtime>;
```

当且仅当 `opts?.pollChannels === true`：

```ts
runtimeConfigById["channel-telegram"] = {
  workspaceRoot,
  poll: true,
};
```

`startHost`：**必须** `createRuntime(opts.workspaceRoot, opts.homeDir, { pollChannels: true })`。CLI 保持两参。

- [ ] **Step 1: Write the failing tests**

`apps/host/tests/telegram.test.ts`：

```ts
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createRuntime, startHost } from "../src/index.ts";
import { ASSEMBLY, writeAssembly } from "./assembly.ts";

const here = fileURLToPath(new URL(".", import.meta.url));

const TELEGRAM_YML = `${ASSEMBLY}  - id: channel-telegram
    name: "@flintloom/channel-telegram"
    config:
      token: tok
      allowedChatIds:
        - 123
`;

function writeTelegramAssembly(workspaceRoot: string): void {
  writeFileSync(join(workspaceRoot, "flintloom.yml"), TELEGRAM_YML);
}

function jsonOk(result: unknown): Response {
  return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
}

describe("telegram host overlay", () => {
  let close: (() => Promise<void>) | undefined;
  const originalFetch = globalThis.fetch;
  afterEach(async () => {
    globalThis.fetch = originalFetch;
    if (close !== undefined) {
      await close();
      close = undefined;
    }
  });

  it("two-arg createRuntime does not call Bot API", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-tg-cli-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-tg-cli-home-"));
    writeTelegramAssembly(workspaceRoot);
    let n = 0;
    globalThis.fetch = async (...args) => {
      n += 1;
      return originalFetch(...args);
    };
    const { stop } = await createRuntime(workspaceRoot, homeDir);
    await new Promise((r) => setTimeout(r, 50));
    expect(n).toBe(0);
    stop();
  });

  it("startHost polls deleteWebhook then getUpdates and close stops", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-tg-host-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-tg-host-home-"));
    writeTelegramAssembly(workspaceRoot);
    const urls: string[] = [];
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      urls.push(u);
      if (u.includes("deleteWebhook")) {
        return jsonOk(true);
      }
      if (u.includes("getUpdates")) {
        await new Promise<void>((_resolve, reject) => {
          const onAbort = () => reject(new DOMException("aborted", "AbortError"));
          if (init?.signal?.aborted) {
            onAbort();
            return;
          }
          init?.signal?.addEventListener("abort", onAbort, { once: true });
        });
      }
      return jsonOk([]);
    };
    const host = await startHost({ workspaceRoot, homeDir, port: 0 });
    close = host.close;
    await vi.waitFor(() => {
      expect(urls.some((u) => u.includes("deleteWebhook"))).toBe(true);
      expect(urls.some((u) => u.includes("getUpdates"))).toBe(true);
    });
    expect(urls[0]).toContain("deleteWebhook");
    const n = urls.length;
    await host.close();
    close = undefined;
    await new Promise((r) => setTimeout(r, 50));
    expect(urls.length).toBe(n);
  });
});

describe("host src factory scan", () => {
  it("does not import telegram adapter", () => {
    const srcDir = join(here, "../src");
    const src = readdirSync(srcDir)
      .filter((name) => name.endsWith(".ts"))
      .map((name) => readFileSync(join(srcDir, name), "utf8"))
      .join("\n");
    expect(src).not.toMatch(/@flintloom\/channel-telegram/);
    expect(src).not.toMatch(/createTelegramAdapter/);
  });
});
```

文件顶部 import 加上 `vi`：`import { afterEach, describe, expect, it, vi } from "vitest";`。

`apps/host/tests/server.test.ts` 与 `apps/host/tests/webhook.test.ts` 的 factory scan 各加：

```ts
    expect(src).not.toMatch(/@flintloom\/channel-telegram/);
    expect(src).not.toMatch(/createTelegramAdapter/);
```

另加：`expect(readFileSync` 不要去改 `flintloom.yml`。可在 `telegram.test.ts` 加：

```ts
it("default assembly yml does not include channel-telegram", () => {
  expect(ASSEMBLY).not.toMatch(/channel-telegram/);
  const rootYml = readFileSync(join(here, "../../../flintloom.yml"), "utf8");
  expect(rootYml).not.toMatch(/channel-telegram/);
});
```

`here` 是 `apps/host/tests/`，上三级到仓库根。确认相对路径：`join(here, "../../../flintloom.yml")` → `flintloom/flintloom.yml`。

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run apps/host/tests/telegram.test.ts`

Expected: FAIL（两参 `createRuntime` 若已 overlay 会误 poll；或 `startHost` 尚未三参，yml 有 telegram 但不 poll，`urls` 空）

- [ ] **Step 3: Write minimal implementation**

`createRuntime` 签名改为第三参可选。在组 `runtimeConfigById` 末尾、`new Context` 之前：

```ts
  if (opts?.pollChannels === true) {
    runtimeConfigById["channel-telegram"] = {
      workspaceRoot,
      poll: true,
    };
  }
```

函数头：

```ts
export async function createRuntime(
  workspaceRoot: string,
  homeDir: string,
  opts?: { pollChannels?: boolean },
): Promise<Runtime> {
```

`startHost`：

```ts
  const runtime = await createRuntime(opts.workspaceRoot, opts.homeDir, {
    pollChannels: true,
  });
```

不要 `import` `@flintloom/channel-telegram`。

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run apps/host/tests/telegram.test.ts apps/host/tests/server.test.ts apps/host/tests/webhook.test.ts packages/channel-telegram packages/loop/tests/run-turn.test.ts`

Expected: PASS

然后全量：`pnpm test` 与 `pnpm typecheck`

Expected: PASS。`flintloom.yml` / `ASSEMBLY` 仍无 `channel-telegram`。

- [ ] **Step 5: Commit**

```powershell
git add apps/host/src/server.ts apps/host/tests/telegram.test.ts apps/host/tests/server.test.ts apps/host/tests/webhook.test.ts
git commit -m @"
feat: start Telegram poll only from startHost overlay
"@
```

不要 add `scripts/desktop-dev.ts` 或 `check_libs.py`。

---

## Spec coverage

| Spec | Task |
|---|---|
| `ctx.provide("turnBusy")`；host HTTP 用同一 Set | 1 |
| `Runtime.stop` = `applyConfig` disposer | 1 |
| `startHost.close`：`closeAllConnections` → `stop` → `server.close` | 1 |
| CLI `stop()` 在 `formatCliOutput` 之后 | 1 |
| `parseTelegramConfig` token / allowlist / poll+workspaceRoot | 2 |
| `createTelegramAdapter`：`channel: "telegram"`、无 `onEvent` | 2 |
| `lastAssistantText` 本包；不从 webhook import | 2 |
| `apply` `register("telegram")`；stop 后 `has` false | 2 |
| 同一 `text`、无 wait 的事件同构 | 2 |
| 根 `package.json` `@flintloom/channel-telegram` | 2 |
| `channel: "telegram"` + a2ui wait → `status === "ok"` 且 `turn/end` | 3 |
| 不改 `channel === "host"` 判断 | 3 |
| 先 `deleteWebhook(drop_pending_updates)` 再 `getUpdates` | 4 |
| 白名单 / trim / busy / awaiting_action / 空 text 不 send / 4096 截断 | 4 |
| `deleteWebhook` 失败则重试且不 getUpdates | 4 |
| `startTelegramPoller` disposer abort | 4 |
| `pollChannels` 仅 `startHost`；两参 createRuntime 不 poll | 5 |
| `close` 后不再 fetch | 5 |
| host src 禁 import telegram 包 | 5 |
| 默认 yml / `ASSEMBLY` 不加 telegram 行 | 5 |
| 不实现 `channels.send`；不新增 HTTP 路由 | 全任务都不做 |

---

## Type consistency

- 服务键：`"channels"`、`"turnBusy"`、`"sessions"`、`"loop"`
- 通道 id：`"telegram"`
- yml 插件 `id`：`"channel-telegram"`（overlay 键）
- `sessionId`：`` `telegram:${String(chat.id)}` ``
- `Runtime = { ctx, stop }`
- `createRuntime(workspaceRoot, homeDir, opts?: { pollChannels?: boolean })`
- `TelegramConfig.apiFetch: typeof fetch`
- Bot 方法名字面量：`deleteWebhook`、`getUpdates`、`sendMessage`
