# FlintLoom A2UI 交互核心 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agent 能 `a2ui_emit` 出带 Button 的卡片，工作台内联渲染并禁用发送；点击后同一 `turnId` 新 SSE 续跑；`flint` 不暂停仍能跑完一轮。

**Architecture:** `@flintloom/a2ui` `provide("a2ui")` 并登记 `a2ui_emit`。校验通过的树写入 session 的 `a2ui/surface`（tool result 只有短 JSON + `emitId`）。loop 在 `channel==="host"` 且 wait 时返回 `awaiting_action`，不写 `turn/end`。Host `POST /v1/turns/:id/actions` 用 `turnId→Session` 找到 session，再 `continueTurn`。Host/loop/session 都不 import `@flintloom/a2ui`。

**Tech Stack:** 现有 kernel 插件、Vitest、React 工作台。不引入 `@a2ui/react`、Cordis、dataagent-v3。

## Global Constraints

- 产品名 FlintLoom；包前缀 `@flintloom/*`；只绑 `127.0.0.1`。
- 不 import / submodule / 拷贝 dataagent-v3、deepseek-harness、Cordis、官方 `@a2ui/react`。
- 禁止往 `createRuntime` 里 `register` 工具。新包必须 `apply`。
- `apps/host/src`、`packages/loop/src`、`packages/session/src` 不得出现 `@flintloom/a2ui`、`createA2uiEmitTool`（连 `import type` 也不要）。
- catalogId 只接受 `flintloom:a2ui:core`；不 fetch URL；字符串属性含 `http://` / `https://` 则 emit 失败。
- 暂停仅 `channel === "host"`；`cli` / `test` 不暂停。
- `validateAction` 只读 session 里的 `messages`，不依赖 `takeEmit`。
- Windows 提交指定文件；不要 `git add -A`。

Spec：`docs/superpowers/specs/2026-08-17-flintloom-a2ui-design.md`

## File map

```text
packages/a2ui/package.json
packages/a2ui/src/types.ts
packages/a2ui/src/validate.ts          # createA2uiService
packages/a2ui/src/tool.ts              # createA2uiEmitTool
packages/a2ui/src/index.ts             # default apply
packages/a2ui/tests/validate.test.ts
packages/a2ui/tests/tool.test.ts
packages/a2ui/tests/plugin.test.ts

packages/session/src/events.ts
packages/session/src/session.ts        # isWaiting
packages/session/tests/session.test.ts

packages/loop/src/run-turn.ts          # awaiting_action + continueTurn
packages/loop/src/plugin.ts
packages/loop/src/index.ts
packages/loop/package.json             # devDependency @flintloom/a2ui（仅测试）
packages/loop/tests/run-turn.test.ts

flintloom.yml
package.json                           # devDependency @flintloom/a2ui
apps/host/src/server.ts                # turns map、close 卸监听、cancel 等待支
apps/host/src/a2ui.ts                  # POST /actions，本地结构类型
apps/host/tests/assembly.ts
apps/host/tests/a2ui.test.ts
apps/host/tests/server.test.ts

apps/desktop/src/types.ts
apps/desktop/src/api.ts                # postTurnAction
apps/desktop/src/A2uiSurface.tsx
apps/desktop/src/App.tsx
apps/desktop/src/app.css
apps/desktop/tests/App.test.tsx
```

默认 yml 在 `docforge` 与 `loop` 之间插入 `a2ui`。

测试夹具（各测试文件内各写一份，不要跨包 import 测试文件）：

```ts
export function confirmMessages(surfaceId = "main") {
  return [
    {
      version: "v0.9" as const,
      createSurface: { surfaceId, catalogId: "flintloom:a2ui:core" },
    },
    {
      version: "v0.9" as const,
      updateComponents: {
        surfaceId,
        components: [
          { id: "root", component: "Column", children: ["title", "ok"] },
          { id: "title", component: "Text", text: "Continue?" },
          {
            id: "ok",
            component: "Button",
            child: "ok-label",
            action: { event: { name: "confirm" } },
          },
          { id: "ok-label", component: "Text", text: "OK" },
        ],
      },
    },
  ];
}
```

---

### Task 1: `createA2uiService`（validate / takeEmit / validateAction）

**Files:**
- Create: `packages/a2ui/package.json`
- Create: `packages/a2ui/src/types.ts`
- Create: `packages/a2ui/src/validate.ts`
- Create: `packages/a2ui/tests/validate.test.ts`
- Modify: 仓库根 `package.json`（`devDependencies` 加 `"@flintloom/a2ui": "workspace:*"`）

**Interfaces:**
- Consumes: 无
- Produces:

```ts
export const A2UI_CATALOG_ID = "flintloom:a2ui:core";

export type A2uiMessage =
  | { version: "v0.9"; createSurface: { surfaceId: string; catalogId: string; theme?: unknown; sendDataModel?: boolean } }
  | { version: "v0.9"; updateComponents: { surfaceId: string; components: A2uiComponent[] } }
  | { version: "v0.9"; updateDataModel: { surfaceId: string; path?: string; value?: unknown } }
  | { version: "v0.9"; deleteSurface: { surfaceId: string } };

export type A2uiComponent = {
  id: string;
  component: "Column" | "Row" | "Text" | "Markdown" | "Button" | "ChoicePicker";
  [key: string]: unknown;
};

export type A2uiAction = {
  surfaceId: string;
  name: string;
  context?: unknown;
  data?: unknown;
};

export type A2uiEmitSnapshot = {
  emitId: string;
  surfaceId: string;
  wait: boolean;
  messages: A2uiMessage[];
};

export type A2uiService = {
  validateEmit(messages: unknown): A2uiEmitSnapshot;
  takeEmit(emitId: string): A2uiEmitSnapshot | undefined;
  validateAction(action: A2uiAction, messages: unknown[]): void;
};

export function createA2uiService(): A2uiService;
```

`validateEmit` 失败抛 `Error`，`message` 仅为短英文：`bad messages` / `too large` / `bad envelope` / `bad catalog` / `unknown component` / `missing root` / `bad ref` / `remote url` / `mixed surface`。成功：`crypto.randomUUID()` 为 `emitId`，放入内部 `Map`，`wait` 为树中是否有 `Button` 或 `ChoicePicker`。`takeEmit` 取出后删除。`validateAction` 失败抛 `unknown surface` 或 `unknown action`。

- [ ] **Step 1: Write the failing test**

`packages/a2ui/tests/validate.test.ts`：把上面的 `confirmMessages` 贴进本文件。然后：

```ts
import { describe, expect, it } from "vitest";
import { createA2uiService } from "../src/validate.ts";

describe("createA2uiService", () => {
  it("accepts a confirm card and takeEmit returns the tree once", () => {
    const svc = createA2uiService();
    const messages = confirmMessages();
    const snap = svc.validateEmit(messages);
    expect(snap.wait).toBe(true);
    expect(snap.surfaceId).toBe("main");
    expect(svc.takeEmit(snap.emitId)?.messages).toEqual(messages);
    expect(svc.takeEmit(snap.emitId)).toBeUndefined();
    expect(() => svc.validateAction({ surfaceId: "main", name: "confirm" }, messages)).not.toThrow();
  });

  it("rejects missing root, unknown component, bad catalog, https, and oversized payload", () => {
    const svc = createA2uiService();
    expect(() => svc.validateEmit([])).toThrow(/bad messages/);
    expect(() =>
      svc.validateEmit([
        { version: "v0.9", createSurface: { surfaceId: "s", catalogId: "flintloom:a2ui:core" } },
        { version: "v0.9", updateComponents: { surfaceId: "s", components: [{ id: "x", component: "Text", text: "hi" }] } },
      ]),
    ).toThrow(/missing root/);
    expect(() =>
      svc.validateEmit([
        { version: "v0.9", createSurface: { surfaceId: "s", catalogId: "flintloom:a2ui:core" } },
        { version: "v0.9", updateComponents: { surfaceId: "s", components: [{ id: "root", component: "Chart" }] } },
      ]),
    ).toThrow(/unknown component/);
    expect(() =>
      svc.validateEmit([
        { version: "v0.9", createSurface: { surfaceId: "s", catalogId: "https://example.com/catalog.json" } },
      ]),
    ).toThrow(/bad catalog/);
    expect(() =>
      svc.validateEmit([
        { version: "v0.9", createSurface: { surfaceId: "s", catalogId: "flintloom:a2ui:core" } },
        { version: "v0.9", updateComponents: { surfaceId: "s", components: [{ id: "root", component: "Text", text: "see https://x.test" }] } },
      ]),
    ).toThrow(/remote url/);
    const huge = confirmMessages();
    (huge[1] as { updateComponents: { components: { text?: string }[] } }).updateComponents.components[1]!.text =
      "x".repeat(70_000);
    expect(() => svc.validateEmit(huge)).toThrow(/too large/);
  });

  it("validateAction uses provided messages, not takeEmit", () => {
    const svc = createA2uiService();
    const messages = confirmMessages();
    const snap = svc.validateEmit(messages);
    svc.takeEmit(snap.emitId);
    expect(() => svc.validateAction({ surfaceId: "main", name: "confirm" }, messages)).not.toThrow();
    expect(() => svc.validateAction({ surfaceId: "main", name: "nope" }, messages)).toThrow(/unknown action/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/a2ui/tests/validate.test.ts`

Expected: FAIL（包不存在）

- [ ] **Step 3: Implement**

`packages/a2ui/package.json`：

```json
{
  "name": "@flintloom/a2ui",
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

根 `package.json` `devDependencies` 加 `"@flintloom/a2ui": "workspace:*"`。然后 `pnpm install`。

`types.ts`：按 Interfaces 导出类型与 `A2UI_CATALOG_ID`。

`validate.ts` 要点：

- `createA2uiService()` 闭包 `Map<string, A2uiEmitSnapshot>`
- 先 `JSON.stringify(messages)`，长度 > 65536 → `too large`；不是长度 1–8 的 array → `bad messages`
- 每条：`version === "v0.9"`，除 `version` 外恰好一个键属于 `createSurface|updateComponents|updateDataModel|deleteSurface`，否则 `bad envelope`
- 所有 `surfaceId` 相同，否则 `mixed surface`
- 非纯 delete：恰好一条 `createSurface` 且 `catalogId === "flintloom:a2ui:core"`，否则 `bad catalog`
- 递归走对象字符串，值含 `http://` 或 `https://` → `remote url`（若该对象只有 `path` 键且值为 `/` 开头的绑定则跳过）
- 合并 `updateComponents` 到 `Map<id, component>`；`component` 必须是六者之一；`Column`/`Row` 的 `children`、`Button` 的 `child` 必须指向已有 id，否则 `bad ref`；无 `root` → `missing root`
- `wait` = 任一 `Button` 或 `ChoicePicker`
- `validateAction`：从 `messages` 重建树；`surfaceId` 对不上 → `unknown surface`；有 Button 则 `name` 必须等于某个 `action.event.name`；无 Button 有 ChoicePicker 则 `name === "choice"`；否则 `unknown action`

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run packages/a2ui/tests/validate.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/a2ui package.json pnpm-lock.yaml
git commit -m "feat: add a2ui envelope validator"
```

---

### Task 2: 插件 + `a2ui_emit`

**Files:**
- Create: `packages/a2ui/src/tool.ts`
- Create: `packages/a2ui/src/index.ts`
- Create: `packages/a2ui/tests/tool.test.ts`
- Create: `packages/a2ui/tests/plugin.test.ts`

**Interfaces:**
- Consumes: `createA2uiService`、`ToolRegistry`
- Produces:

```ts
export function createA2uiEmitTool(svc: A2uiService): ToolDefinition;
// default export name "@flintloom/a2ui"
// apply: require("tools"), provide("a2ui"), register a2ui_emit
```

工具：`signal.aborted` → `aborted`。`args.messages` 交给 `validateEmit`；抛错 → `failed: ${err.message}`。成功 → `JSON.stringify({ status: "ok", surfaceId, wait, emitId })`（**无** `messages`）。

- [ ] **Step 1: Write the failing tests**

`packages/a2ui/tests/tool.test.ts`（再次内贴 `confirmMessages`）：

```ts
import { describe, expect, it } from "vitest";
import { createA2uiService } from "../src/validate.ts";
import { createA2uiEmitTool } from "../src/tool.ts";

const exec = { workspaceRoot: "/tmp", signal: new AbortController().signal, channel: "cli" };

describe("a2ui_emit", () => {
  it("returns short json without messages and rejects abort / missing messages", async () => {
    const svc = createA2uiService();
    const tool = createA2uiEmitTool(svc);
    const raw = await tool.execute({ messages: confirmMessages() }, exec);
    const parsed = JSON.parse(raw) as { status: string; emitId: string; wait: boolean };
    expect(parsed.status).toBe("ok");
    expect(parsed.wait).toBe(true);
    expect(raw).not.toContain("Continue?");
    expect(JSON.parse(raw)).not.toHaveProperty("messages");
    expect(svc.takeEmit(parsed.emitId)?.surfaceId).toBe("main");
    expect(await tool.execute({}, exec)).toMatch(/^failed:/);
    const ac = new AbortController();
    ac.abort();
    expect(await tool.execute({ messages: confirmMessages() }, { ...exec, signal: ac.signal })).toBe("aborted");
  });
});
```

`packages/a2ui/tests/plugin.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { Context } from "@flintloom/kernel";
import modelsPlugin from "@flintloom/models";
import toolsPlugin, { type ToolRegistry } from "@flintloom/tools";
import plugin from "../src/index.ts";
import type { A2uiService } from "../src/types.ts";

describe("a2ui plugin", () => {
  it("registers a2ui_emit and stop() unregisters it", () => {
    const ctx = new Context();
    ctx.plugin(modelsPlugin);
    ctx.plugin(toolsPlugin);
    const stop = ctx.plugin(plugin);
    const tools = ctx.require<ToolRegistry>("tools");
    expect(tools.schemas().map((s) => s.name)).toContain("a2ui_emit");
    ctx.require<A2uiService>("a2ui");
    stop();
    expect(tools.schemas().map((s) => s.name)).not.toContain("a2ui_emit");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run packages/a2ui/tests/tool.test.ts packages/a2ui/tests/plugin.test.ts`

Expected: FAIL

- [ ] **Step 3: Implement**

`tool.ts`：`createA2uiEmitTool` 如 Interfaces。

`index.ts`：

```ts
import type { Context, FlintPlugin } from "@flintloom/kernel";
import type { ToolRegistry } from "@flintloom/tools";
import { createA2uiEmitTool } from "./tool.ts";
import { createA2uiService } from "./validate.ts";

const plugin: FlintPlugin = {
  name: "@flintloom/a2ui",
  apply(ctx: Context) {
    const tools = ctx.require<ToolRegistry>("tools");
    const svc = createA2uiService();
    ctx.provide("a2ui", svc);
    ctx.effect(tools.register(createA2uiEmitTool(svc)));
  },
};

export type {
  A2uiAction,
  A2uiComponent,
  A2uiEmitSnapshot,
  A2uiMessage,
  A2uiService,
} from "./types.ts";
export { A2UI_CATALOG_ID } from "./types.ts";
export { createA2uiService } from "./validate.ts";
export { createA2uiEmitTool } from "./tool.ts";
export default plugin;
```

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run packages/a2ui`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/a2ui
git commit -m "feat: register a2ui_emit from a2ui plugin"
```

---

### Task 3: session `a2ui/*` 事件 + `isWaiting`

**Files:**
- Modify: `packages/session/src/events.ts`
- Modify: `packages/session/src/session.ts`
- Modify: `packages/session/tests/session.test.ts`

**Interfaces:**
- Consumes: 现有 `Session.append` / `deriveMessages`
- Produces: `SessionEvent` 增加 `a2ui/surface`（`messages: unknown[]`）与 `a2ui/action`；`session.isWaiting(turnId: string): boolean`；`deriveMessages` 忽略 surface、把 action 变成 `user` JSON。

- [ ] **Step 1: Write the failing test**

在 `packages/session/tests/session.test.ts` 追加：

```ts
  it("isWaiting and deriveMessages for a2ui action", () => {
    const session = new Session("s-a2ui");
    session.append({ type: "turn/start", turnId: "t1" });
    session.append({
      type: "a2ui/surface",
      turnId: "t1",
      surfaceId: "main",
      wait: true,
      messages: [{ version: "v0.9", createSurface: { surfaceId: "main", catalogId: "flintloom:a2ui:core" } }],
    });
    expect(session.isWaiting("t1")).toBe(true);
    expect(session.deriveMessages()).toEqual([]);
    session.append({
      type: "a2ui/action",
      turnId: "t1",
      surfaceId: "main",
      name: "confirm",
    });
    expect(session.isWaiting("t1")).toBe(false);
    expect(session.deriveMessages()).toEqual([
      {
        role: "user",
        content: JSON.stringify({
          type: "a2ui/action",
          surfaceId: "main",
          name: "confirm",
        }),
      },
    ]);
    session.append({ type: "turn/end", turnId: "t1", status: "ok" });
    expect(session.isWaiting("t1")).toBe(false);
  });
```

`a2ui/action` 若带 `context`/`data`，JSON 里只包含实际存在的键（与 append 对象一致；测试这条不传可选字段）。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/session/tests/session.test.ts`

Expected: FAIL（无 `isWaiting` / 未知事件类型）

- [ ] **Step 3: Implement**

`events.ts` 联合类型增加：

```ts
| { type: "a2ui/surface"; turnId: string; surfaceId: string; messages: unknown[]; wait: boolean }
| { type: "a2ui/action"; turnId: string; surfaceId: string; name: string; context?: unknown; data?: unknown }
```

`session.ts`：

- `isWaiting(turnId)`：正向扫描；记下该 `turnId` 的 start 之后是否已 `turn/end`；在未 end 的区间里找最后一条 `a2ui/surface` 与之后是否有 `a2ui/action`。`wait===true` 且无更新 action → true。
- `deriveMessages` 的 `switch` 增加 `a2ui/action` 分支（`flushCalls` 后 push user）；`a2ui/surface` 走不到任何 case 即可（与 chunk 一样忽略——**必须加 `case "a2ui/surface": break`** 以免将来变 exhaustive）。

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run packages/session`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/session
git commit -m "feat: record a2ui surface and action in session log"
```

---

### Task 4: loop `awaiting_action` + `continueTurn`

**Files:**
- Modify: `packages/loop/src/run-turn.ts`
- Modify: `packages/loop/src/plugin.ts`
- Modify: `packages/loop/src/index.ts`
- Modify: `packages/loop/package.json`（`devDependencies` 加 `@flintloom/a2ui`）
- Modify: `packages/loop/tests/run-turn.test.ts`

**Interfaces:**
- Consumes: `Session.isWaiting`；结构类型

```ts
type A2uiLoopService = {
  takeEmit(emitId: string): { surfaceId: string; wait: boolean; messages: unknown[] } | undefined;
  validateAction(
    action: { surfaceId: string; name: string; context?: unknown; data?: unknown },
    messages: unknown[],
  ): void;
};
```

- Produces:

```ts
export type RunTurnResult = { turnId: string; status: "ok" | "failed" | "cancelled" | "awaiting_action" };

export type ContinueTurnInput = {
  ctx: Context;
  session: Session;
  turnId: string;
  action: { surfaceId: string; name: string; context?: unknown; data?: unknown };
  workspaceRoot: string;
  channel: string;
  signal: AbortSignal;
  onEvent?: (event: SessionEvent) => void;
};

export type LoopService = {
  runTurn(input: RunTurnInput): Promise<RunTurnResult>;
  continueTurn(input: ContinueTurnInput): Promise<RunTurnResult>;
};
```

每步工具后：若 `name === "a2ui_emit"` 且 result parse 出 `status==="ok"` 与 `emitId`，`ctx.get<A2uiLoopService>("a2ui")?.takeEmit(emitId)` 有值则 append `a2ui/surface`。全部工具结束后：`channel === "host"` 且本步曾 append `wait===true` 的 surface → 若 `accumulatedText` 非空则先 `assistant/message` → return `awaiting_action`。`continueTurn`：`!session.isWaiting(turnId)` 则 `throw new Error("not waiting")`；否则 `validateAction`、append `a2ui/action`、从 step 0 再跑（**不要**再 `turn/start` / `user/message`）。把 step 循环抽成内部 `runSteps(...)` 以免复制。

- [ ] **Step 1: Write the failing tests**

在 `run-turn.test.ts` 增加 import：`import a2uiPlugin from "@flintloom/a2ui"`，并内贴 `confirmMessages`。`boot()` **不要**自动挂 a2ui（现有用例保持无 a2ui）。新用例自己 `ctx.plugin(a2uiPlugin)`。

```ts
  it("pauses on host channel after a2ui_emit wait and continues after action", async () => {
    let streamCall = 0;
    const fakeChat: ChatProvider = {
      async *stream() {
        streamCall += 1;
        if (streamCall === 1) {
          yield {
            type: "tool_call",
            id: "c1",
            name: "a2ui_emit",
            args: { messages: confirmMessages() },
          };
        } else {
          yield { type: "text", text: "done-after-click" };
        }
      },
    };
    const ctx = boot();
    ctx.plugin(a2uiPlugin);
    ctx.require<ModelRegistry>("models").registerChat("fake", fakeChat);
    ctx.require<ModelRegistry>("models").setDefault("chat", "fake");
    const session = new Session("s-a2ui");
    const first = await runTurn({
      ctx,
      session,
      text: "show card",
      workspaceRoot: process.cwd(),
      channel: "host",
      signal: new AbortController().signal,
    });
    expect(first.status).toBe("awaiting_action");
    expect(session.events().some((e) => e.type === "turn/end")).toBe(false);
    expect(session.events().some((e) => e.type === "a2ui/surface")).toBe(true);
    const tool = session.events().find((e) => e.type === "tool/result");
    expect(tool && "text" in tool ? tool.text : "").not.toContain("Continue?");

    const { continueTurn } = await import("../src/index.ts");
    const second = await continueTurn({
      ctx,
      session,
      turnId: first.turnId,
      action: { surfaceId: "main", name: "confirm" },
      workspaceRoot: process.cwd(),
      channel: "host",
      signal: new AbortController().signal,
    });
    expect(second.status).toBe("ok");
    expect(second.turnId).toBe(first.turnId);
    expect(session.events().some((e) => e.type === "turn/end" && e.status === "ok")).toBe(true);
    expect(streamCall).toBe(2);
  });

  it("does not pause a2ui wait on cli channel", async () => {
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
          yield { type: "text", text: "cli-skip-wait" };
        }
      },
    };
    const ctx = boot();
    ctx.plugin(a2uiPlugin);
    ctx.require<ModelRegistry>("models").registerChat("fake", fakeChat);
    ctx.require<ModelRegistry>("models").setDefault("chat", "fake");
    const session = new Session("s-cli");
    const result = await runTurn({
      ctx,
      session,
      text: "emit",
      workspaceRoot: process.cwd(),
      channel: "cli",
      signal: new AbortController().signal,
    });
    expect(result.status).toBe("ok");
    expect(session.events().some((e) => e.type === "turn/end")).toBe(true);
  });

  it("continueTurn throws when not waiting", async () => {
    const ctx = boot();
    ctx.plugin(a2uiPlugin);
    const session = new Session("s-no");
    session.append({ type: "turn/start", turnId: "t-x" });
    session.append({ type: "turn/end", turnId: "t-x", status: "ok" });
    const { continueTurn } = await import("../src/index.ts");
    await expect(
      continueTurn({
        ctx,
        session,
        turnId: "t-x",
        action: { surfaceId: "main", name: "confirm" },
        workspaceRoot: process.cwd(),
        channel: "host",
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/not waiting/);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run packages/loop/tests/run-turn.test.ts`

Expected: FAIL（无 `continueTurn` / 不会 awaiting_action）

- [ ] **Step 3: Implement**

`pnpm install`（loop 的 devDependency）。

`run-turn.ts`：抽出 `runSteps`（从 `for (let step = 0; step < MAX_STEPS; step++)` 到函数结束的循环）。`runTurn` 仍写 `turn/start` + `user/message` 再 `return runSteps(...)`。工具结果处理：

```ts
let stepWait = false;
// inside each tool result, after append tool/result:
if (call.name === "a2ui_emit") {
  let parsed: { status?: string; emitId?: string; wait?: boolean; surfaceId?: string };
  try {
    parsed = JSON.parse(resultText) as typeof parsed;
  } catch {
    parsed = {};
  }
  const a2ui = input.ctx.get<A2uiLoopService>("a2ui");
  if (parsed.status === "ok" && typeof parsed.emitId === "string" && a2ui) {
    const snap = a2ui.takeEmit(parsed.emitId);
    if (snap) {
      appendEvent(session, onEvent, {
        type: "a2ui/surface",
        turnId,
        surfaceId: snap.surfaceId,
        messages: snap.messages,
        wait: snap.wait,
      });
      if (snap.wait) stepWait = true;
    }
  }
}
// after all tools in the step:
if (channel === "host" && stepWait) {
  if (accumulatedText.length > 0) {
    appendEvent(session, onEvent, { type: "assistant/message", text: accumulatedText });
  }
  return { turnId, status: "awaiting_action" };
}
```

`continueTurn`：校验 `session.isWaiting(input.turnId)` 且最后一次 `turn/start` 的 id 等于 `input.turnId`；从 `session.events()` 倒序找该 turn 的 `a2ui/surface`；`ctx.get("a2ui")` 缺失则 throw `not waiting`（测试里有插件）；`validateAction`；append `a2ui/action`；`return runSteps({ ...input, turnId })`。

`plugin.ts`：`ctx.provide("loop", { runTurn, continueTurn })`。

`index.ts` 导出 `continueTurn` 与 `ContinueTurnInput`。

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run packages/loop packages/a2ui packages/session`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/loop
git commit -m "feat: pause host turns for a2ui actions"
```

---

### Task 5: yml + host `/actions` + cancel 等待支

**Files:**
- Modify: `flintloom.yml`
- Modify: `apps/host/tests/assembly.ts`
- Modify: `apps/host/src/server.ts`
- Create: `apps/host/src/a2ui.ts`
- Create: `apps/host/tests/a2ui.test.ts`
- Modify: `apps/host/tests/server.test.ts`

**Interfaces:**
- Consumes: `LoopService.continueTurn`、`Session.isWaiting`、`ctx.get("a2ui")` 结构类型（**不要** import `@flintloom/a2ui`）
- Produces: `POST /v1/turns/:id/actions`；`turns: Map<string, Session>`；awaiting 时卸 `req.close` abort；等待态 cancel 写 `turn/end cancelled`

`handleRequest` opts 增加 `turns: Map<string, Session>`。`onEvent`：`turn/start` → `turns.set` + `controllers.set`；`turn/end` → 两个都 `delete`。`runTurn`/`continueTurn` 返回后：`controllers.delete`；若 `status !== "awaiting_action"` 且尚未因 `turn/end` 删过，再 `turns.delete`。

close 监听：

```ts
const onClose = () => {
  controller.abort();
};
req.on("close", onClose);
// after result:
if (result.status === "awaiting_action") {
  req.off("close", onClose);
}
controllers.delete(result.turnId);
writeSse(res, { type: "end", status: result.status });
res.end();
```

Cancel：`turns.get(turnId)` 没有且 `controllers` 没有 → 404。有 controller → abort（现有）。否则 `session.isWaiting(turnId)` → append `turn/end cancelled`，`turns.delete`，200。

`apps/host/src/a2ui.ts` 的 `handleTurnActions` 返回 `boolean`（已处理）。无 `ctx.get("a2ui")` → 404。body > 64KiB 或缺字段 → 400。`!session.isWaiting` → 409。`validateAction` throw → 400。成功则 **200 SSE** 调 `continueTurn`（与 `/v1/turns` 同样写 SSE）。

- [ ] **Step 1: Write the failing HTTP tests**

`apps/host/tests/a2ui.test.ts`：用 `startHost` + `writeAssembly`。假 chat 必须能被 runtime 用到——**不要**改 createRuntime 去 register。HTTP 测试走 **真的 yml 插件**，但 chat 需要 API key 才会配置。知识库 HTTP 测试不跑 turn。

本任务 HTTP 测 **不依赖真模型**：直接单测 `handleTurnActions` 会过重。改为：在 `a2ui.test.ts` 里对 `createRuntime` 后的 ctx **再** `registerChat` 假模型（与 loop 测试相同），然后 **不要** `startHost` 的真 `runTurn` 打真实 API。

更稳：host 测试只覆盖「无插件 404 / 无 token 401 / factory 扫描 / schema 含 a2ui_emit」。等待态 SSE 与 cancel 用 **注入假 chat 的 startHost 做不到**，除非 overlay。

做这两类：

1. `server.test.ts`：factory 扫描加 `@flintloom/a2ui`、`createA2uiEmitTool`；schema 用例 `toContain("a2ui_emit")`。
2. `a2ui.test.ts`：yml 去掉 a2ui（保留 loop，去掉 a2ui 行）→ `POST /v1/turns/x/actions` 404；无 Bearer 401。
3. loop 已覆盖 pause/continue。Host 再加一个 **轻量** 测试：`createRuntime` + 假 chat + 自己 `createServer` 太重。改为导出测试 `isAuthorized` 不够。

**补一条不经过 LLM 的 cancel/waiting：** 在 `a2ui.test.ts` 里 `startHost`，拿到 token 后无法造 waiting session（session 在 host 进程内）。

因此：把 `turns` map 行为放进 `apps/host/tests/a2ui.test.ts`，通过 **先 POST /v1/turns** 不可行。

允许的做法：在 `server.ts` 的 cancel/actions 用 `session.isWaiting`。测试用 `createRuntime` + 手工 `session.append` **不能**打到 HTTP，因为 Session 实例不在 HTTP 的 store 里同一条除非 `sessions.getOrCreate`。

流程：

```ts
const host = await startHost({ workspaceRoot, homeDir, port: 0 });
const { ctx } = await createRuntime(...) // 这是另一个 runtime，不行。
```

必须用 **同一个** runtime。`startHost` 不暴露 ctx。

**本任务改 `startHost` 返回值？禁止扩 API。** 用已有 `createRuntime` + 直接 import `handleRequest`？`handleRequest` 未导出。

最小切口：`startHost` 已返回 `{ url, close }`。在 `a2ui.test.ts` 只测 401/404/yml 省略。等待态 cancel 的回归放在 **导出一个纯函数** `cancelWaitingTurn(session, turnId): boolean` 放 `apps/host/src/a2ui.ts` 并单测它：若 `isWaiting` 则 append `turn/end cancelled` 返回 true。`server.ts` cancel 调用它。这样不需要假 LLM HTTP。

SSE close 不 abort：在 `a2ui.ts` 不测 socket；loop+上面的纯函数足够。另写 host 测试注释说明 LLM 路径由 loop 测。

`apps/host/tests/a2ui.test.ts`：

```ts
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Session } from "@flintloom/session";
import { cancelWaitingTurn } from "../src/a2ui.ts";
import { loadOrCreateToken, startHost } from "../src/index.ts";
import { writeAssembly } from "./assembly.ts";

describe("a2ui HTTP", () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    if (close) {
      await close();
      close = undefined;
    }
  });

  it("cancelWaitingTurn appends turn/end cancelled", () => {
    const session = new Session("s");
    session.append({ type: "turn/start", turnId: "t1" });
    session.append({
      type: "a2ui/surface",
      turnId: "t1",
      surfaceId: "main",
      wait: true,
      messages: [],
    });
    expect(cancelWaitingTurn(session, "t1")).toBe(true);
    expect(session.events().some((e) => e.type === "turn/end" && e.status === "cancelled")).toBe(true);
    expect(cancelWaitingTurn(session, "t1")).toBe(false);
  });

  it("returns 401 without bearer and 404 when a2ui plugin omitted", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-a2ui-http-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-a2ui-http-home-"));
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
    const unauth = await fetch(`${host.url}/v1/turns/t1/actions`, { method: "POST" });
    expect(unauth.status).toBe(401);
    const token = loadOrCreateToken(homeDir);
    const res = await fetch(`${host.url}/v1/turns/t1/actions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ surfaceId: "main", name: "confirm" }),
    });
    expect(res.status).toBe(404);
  });
});
```

`server.test.ts` factory 扫描增加：

```ts
expect(src).not.toMatch(/@flintloom\/a2ui/);
expect(src).not.toMatch(/createA2uiEmitTool/);
```

`registers doc_probe...` 增加 `toContain("a2ui_emit")`。

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run apps/host/tests/a2ui.test.ts apps/host/tests/server.test.ts`

Expected: FAIL

- [ ] **Step 3: Implement**

`flintloom.yml` 与 `ASSEMBLY` 在 docforge 与 loop 之间插入：

```yaml
  - id: a2ui
    name: "@flintloom/a2ui"
```

`apps/host/src/a2ui.ts`：本地 `A2uiService` 结构类型（`validateAction` + 可选，actions 需要它证明插件在）。`cancelWaitingTurn`：

```ts
export function cancelWaitingTurn(session: Session, turnId: string): boolean {
  if (!session.isWaiting(turnId)) return false;
  session.append({ type: "turn/end", turnId, status: "cancelled" });
  return true;
}
```

`handleTurnActions(...)`：解析 body；`turns.get(turnId)` 没有 → 409；`ctx.get("a2ui")` 没有 → 404；`validateAction` 用 session 最后一条 surface 的 `messages`；然后 `loop.continueTurn` + SSE（把 `onEvent`/`close`/`awaiting` 逻辑抽成 `pipeTurnSse` 也可，允许在 `server.ts` 里复制一小段 POST /v1/turns 的 SSE 样板以免大重构）。**优先**在 `server.ts` 抽 `async function streamLoopResult(res, req, work)` 给 turns 与 actions 共用，避免两套 close 监听。

`server.ts`：`turns` map；cancel 调 `cancelWaitingTurn`。

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run apps/host packages/loop packages/a2ui packages/session`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add flintloom.yml apps/host
git commit -m "feat: continue a2ui turns over host actions"
```

---

### Task 6: 工作台内联 surface + 等待态

**Files:**
- Modify: `apps/desktop/src/types.ts`
- Modify: `apps/desktop/src/api.ts`
- Create: `apps/desktop/src/A2uiSurface.tsx`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/app.css`
- Modify: `apps/desktop/tests/App.test.tsx`

**Interfaces:**
- Consumes: SSE `a2ui/surface`、`end.status === "awaiting_action"`
- Produces: 聊天列卡片；`waitingAction` 时发送 disabled、显示取消；Button 调用 `postTurnAction(turnId, { surfaceId, name, data })`

```ts
export async function postTurnAction(
  turnId: string,
  body: { surfaceId: string; name: string; context?: unknown; data?: unknown },
  onEvent: (event: WorkbenchEvent) => void,
  signal?: AbortSignal,
): Promise<void>;
```

实现与 `postTurn` 相同的 SSE 读取，URL 为 `/v1/turns/${encodeURIComponent(turnId)}/actions`，method POST。

- [ ] **Step 1: Write the failing UI tests**

`installFetch` 增加 `actions?: Response | Error`。URL 含 `/actions` 的 POST 走该分支，默认 SSE：

```
data: {"type":"assistant/message","text":"after-click"}\n\n
data: {"type":"end","status":"ok"}\n\n
```

新用例：

1. mount，发 `hi`，turn SSE 为 surface + `end awaiting_action` → 可见 `OK` 按钮；发送按钮 disabled；可见「取消」。
2. 点 `OK` → fetch URL 含 `/actions`，body JSON `name === "confirm"` 且 `surfaceId === "main"`。
3. 现有 hello 用例不得因缺 actions mock 失败（默认 installFetch 已覆盖）。

surface SSE 夹具（`confirmMessages` 缩进成一行塞进 JSON）：

```ts
const SURFACE_SSE =
  `data: ${JSON.stringify({
    type: "a2ui/surface",
    turnId: "t-wait",
    surfaceId: "main",
    wait: true,
    messages: confirmMessages(),
  })}\n\n` + `data: {"type":"end","status":"awaiting_action"}\n\n`;
```

`types.ts` 的 `TurnEnd.status` 增加 `"awaiting_action"`；`WorkbenchEvent` 增加 `a2ui/surface` 与 `a2ui/action`。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run apps/desktop/tests/App.test.tsx`

Expected: FAIL（无卡片 / 发送仍 enabled）

- [ ] **Step 3: Implement**

`A2uiSurface.tsx`：props `{ messages: unknown[]; interactive: boolean; onAction: (name: string, data?: unknown) => void }`。解析 `updateComponents` 成 `Map<id, comp>`，从 `root` 递归渲染。`Column`=`flex-direction:column`，`Row`=`row`。`Text`/`Markdown` 用 `<span>` / `<pre>`（Markdown **不** `dangerouslySetInnerHTML`）。`Button`：`disabled={!interactive}`，click → `onAction(action.event.name)`。`ChoicePicker`：`<select>`；若 `interactive` 且树中无 Button，`onChange` → `onAction("choice", { value })`。

`App.tsx`：

- Bubble 增加 `{ kind: "a2ui"; surfaceId: string; messages: unknown[]; turnId: string }`
- `bubbleFromHistory` 处理 `a2ui/surface`
- state `waitingAction`；`end.status === "awaiting_action"` → `setWaitingAction(true)`、`setSending(false)`；`end` 为 ok/failed/cancelled → `setWaitingAction(false)`
- 发送按钮 `disabled={sending || waitingAction || !input.trim()}`（若今日只靠 sending 拦截，改为 waiting 时 disabled）
- `waitingAction || sending` 时显示「取消」
- 重放 session：若 events 满足 waiting（最后 turn 无 end 且最后 surface wait），`setWaitingAction(true)` 并设置 `turnIdRef`
- 点按钮：`postTurnAction(turnIdRef.current, { surfaceId, name, data })`，复用 `onEvent` 逻辑

`app.css`：`.bubble.a2ui` 边框、内边距；`.a2ui-row` / `.a2ui-column` 为 flex + gap。

- [ ] **Step 4: Run tests**

Run: `pnpm test`

Expected: 全绿

- [ ] **Step 5: Commit**

```bash
git add apps/desktop
git commit -m "feat: render a2ui surfaces in the workbench chat"
```

---

## Self-review

| Spec | Task |
|---|---|
| validate / catalog / 禁 https | 1 |
| `a2ui_emit` 短 JSON + emitId | 2 |
| session 事件 + isWaiting | 3 |
| host 暂停 / continueTurn / cli 不暂停 | 4 |
| yml、/actions、turns map、cancel 等待、close 不 abort、host 不 import 包 | 5 |
| 内联卡片、发送 disabled、取消 | 6 |
| 不改知识库 / Files | 约束 |
| table/chart/infographic | 非目标 |

无 TBD。`cancelWaitingTurn` 与 `turns` map 覆盖 spec 里「URL 只有 turnId」和「等待态 cancel 必须写 turn/end」。
