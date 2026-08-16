# FlintLoom 第一刀：Kernel + Loop + CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在空仓里做出可运行的 `flint`：对着一个工作区发一句话，假或真的 `chat` 模型能调 `fs`/`grep`/`shell`，session log 能重放，host 在 `127.0.0.1:7331` 用 token 提供同一套 turn。

**Architecture:** Flint 与 Loom 同进程。`Context` 加载 `flintloom.yml` 插件；`Session` 只追加事件；`ctx.models` 按 kind 解析（缺 kind 失败，禁止用 chat 冒充）；`runTurn` 驱动 step；工具先走工作区确定性闸门，再走可选 `guard`。CLI 与 HTTP host 都调用 `runTurn`。

**Tech Stack:** Node 22+、TypeScript 5.7、pnpm workspaces、Vitest、YAML（`yaml` 包）、内置 `fetch`（OpenAI 兼容 chat）。不引入 dataagent-v3 / deepseek-harness / Cordis。

## Global Constraints

- 口号与产品名：FlintLoom，A real agent. / 真正的 Agent。
- 包名前缀：`@flintloom/*`；CLI 二进制：`flint`。
- 只绑定 `127.0.0.1`；host 默认端口 `7331`；请求必须带 host token。
- 密钥只来自环境变量 `FLINTLOOM_API_KEY` 或 `~/.flintloom/credentials`（测试用临时目录覆盖 home）。
- 不 import、不 submodule、不拷贝 dataagent-v3 或 deepseek-harness。
- `ctx.models` kind 枚举第一天就包含：`chat` | `omni` | `asr` | `tts` | `t2i` | `t2v` | `embedding` | `rerank` | `guard`。v1 只实现 `chat` provider。
- 未配置的 kind 解析必须抛错，不得回退到 `chat`。
- 工具路径必须 `realpath` 落在 workspace 内；`guard` 只能加严。
- 本计划只做 spec 第 16 节第一刀。不做桌面、DocForge、A2UI、知识库、MCP、skill、Telegram、webhook、`flint plugin add`。

## File map

```text
flintloom/
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
  vitest.config.ts
  flintloom.yml
  packages/kernel/package.json
  packages/kernel/src/context.ts
  packages/kernel/src/config.ts
  packages/kernel/src/index.ts
  packages/kernel/tests/context.test.ts
  packages/kernel/tests/config.test.ts
  packages/session/src/events.ts
  packages/session/src/session.ts
  packages/session/src/index.ts
  packages/session/tests/session.test.ts
  packages/models/src/kinds.ts
  packages/models/src/errors.ts
  packages/models/src/registry.ts
  packages/models/src/index.ts
  packages/models/tests/registry.test.ts
  packages/tools/src/workspace.ts
  packages/tools/src/types.ts
  packages/tools/src/registry.ts
  packages/tools/src/index.ts
  packages/tools/tests/workspace.test.ts
  packages/tools/tests/registry.test.ts
  packages/fs/src/index.ts
  packages/fs/tests/fs.test.ts
  packages/grep/src/index.ts
  packages/grep/tests/grep.test.ts
  packages/shell/src/index.ts
  packages/shell/tests/shell.test.ts
  packages/loop/src/run-turn.ts
  packages/loop/src/index.ts
  packages/loop/tests/run-turn.test.ts
  packages/models-chat/src/openai-compat.ts
  packages/models-chat/src/index.ts
  packages/models-chat/tests/openai-compat.test.ts
  apps/host/src/token.ts
  apps/host/src/server.ts
  apps/host/src/index.ts
  apps/host/tests/server.test.ts
  apps/cli/src/bin.ts
  apps/cli/tests/cli.test.ts
```

---

### Task 1: pnpm 工作区骨架

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `vitest.config.ts`
- Create: `packages/kernel/package.json`
- Create: `packages/kernel/tsconfig.json`
- Create: `packages/kernel/src/index.ts`
- Create: `packages/kernel/src/context.ts`
- Test: `packages/kernel/tests/context.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `Context`（见本任务实现）；根脚本 `pnpm test`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from "vitest";
import { Context } from "../src/index.ts";

describe("Context", () => {
  it("provide 的值在 plugin dispose 后消失", () => {
    const ctx = new Context();
    const stop = ctx.plugin({
      name: "probe",
      apply(c) {
        c.provide("probe.n", 7);
      },
    });
    expect(ctx.get<number>("probe.n")).toBe(7);
    stop();
    expect(ctx.get<number>("probe.n")).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run packages/kernel/tests/context.test.ts`
Expected: FAIL（包或 `Context` 还不存在）

- [ ] **Step 3: 写最小骨架与实现**

根 `package.json`：

```json
{
  "name": "flintloom",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.14.0",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -b"
  },
  "engines": { "node": ">=22" }
}
```

`pnpm-workspace.yaml`：

```yaml
packages:
  - "packages/*"
  - "apps/*"
```

`tsconfig.base.json`：`"strict": true`，`"module": "NodeNext"`，`"moduleResolution": "NodeNext"`，`"target": "ES2022"`。

`packages/kernel/src/context.ts`：

```ts
export interface FlintPlugin {
  name: string;
  apply(ctx: Context): void;
}

export type Disposer = () => void;

export class Context {
  #values = new Map<string, unknown>();
  #disposers: Disposer[] = [];

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

  plugin(plugin: FlintPlugin): Disposer {
    const before = this.#disposers.length;
    plugin.apply(this);
    const mine = this.#disposers.slice(before);
    return () => {
      for (const d of mine.reverse()) d();
    };
  }
}
```

`src/index.ts` 导出 `Context`、`FlintPlugin`、`Disposer`。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm install && pnpm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json vitest.config.ts packages/kernel
git commit -m "feat: add FlintLoom kernel Context with disposable plugins"
```

---

### Task 2: 加载 flintloom.yml

**Files:**
- Create: `packages/kernel/src/config.ts`
- Create: `flintloom.yml`
- Test: `packages/kernel/tests/config.test.ts`
- Modify: `packages/kernel/package.json`（加依赖 `yaml`）
- Modify: `packages/kernel/src/index.ts`

**Interfaces:**
- Consumes: `Context`、`FlintPlugin`
- Produces: `loadConfig(text: string): FlintloomConfig`；`type FlintloomPluginRow = { id: string; name: string; config?: Record<string, unknown> }`；`type FlintloomConfig = { plugins: FlintloomPluginRow[] }`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/index.ts";

describe("loadConfig", () => {
  it("读出 plugins 列表", () => {
    const cfg = loadConfig(`
plugins:
  - id: session
    name: "@flintloom/session"
`);
    expect(cfg.plugins).toEqual([
      { id: "session", name: "@flintloom/session" },
    ]);
  });

  it("缺少 plugins 则抛错", () => {
    expect(() => loadConfig("foo: 1\n")).toThrow(/plugins/);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run packages/kernel/tests/config.test.ts`
Expected: FAIL（`loadConfig` 未导出）

- [ ] **Step 3: 实现 `loadConfig`**

用 `yaml` 的 `parse`。根必须是 object 且 `plugins` 为数组；每一项必须有非空字符串 `id` 与 `name`。缺字段抛 `Error`，消息含字段名。根目录放一份最小 `flintloom.yml`（先只列注释 + 空 plugins 数组，后续任务往里加行）。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run packages/kernel/tests/config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/kernel flintloom.yml
git commit -m "feat: parse flintloom.yml plugin list"
```

---

### Task 3: Session log 与投影

**Files:**
- Create: `packages/session/package.json`（依赖 `@flintloom/kernel` workspace）
- Create: `packages/session/src/events.ts`
- Create: `packages/session/src/session.ts`
- Create: `packages/session/src/index.ts`
- Test: `packages/session/tests/session.test.ts`

**Interfaces:**
- Consumes: 无（session 不依赖 Context）
- Produces:

```ts
export type SessionEvent =
  | { type: "turn/start"; turnId: string }
  | { type: "turn/end"; turnId: string; status: "ok" | "failed" | "cancelled" }
  | { type: "user/message"; text: string }
  | { type: "assistant/chunk"; text: string }
  | { type: "assistant/message"; text: string }
  | { type: "tool/call"; callId: string; name: string; args: unknown }
  | { type: "tool/result"; callId: string; name: string; text: string }
  | { type: "model/error"; kind: string; message: string }
  | { type: "guard/decision"; tool: string; decision: "allow" | "deny" | "ask" };

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  name?: string;
}

export class Session {
  constructor(readonly id: string) {}
  append(event: SessionEvent): void
  events(): readonly SessionEvent[]
  deriveMessages(): ChatMessage[]
}
```

`deriveMessages` 规则：`user/message` → user；`assistant/message` → assistant（忽略 chunk，避免重复）；`tool/result` → role `tool`。其它事件不进入模型历史。

- [ ] **Step 1: 写失败测试**

断言：append 三条（user、assistant/chunk、assistant/message）后 `deriveMessages()` 只有 user + assistant 两条，chunk 不单独成消息。再断言 `events()` 仍包含 chunk。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run packages/session/tests/session.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 Session**

内存数组只追加，禁止 splice。`deriveMessages` 按上面规则投影。

- [ ] **Step 4: 跑测试确认通过**

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/session
git commit -m "feat: append-only session log with message projection"
```

---

### Task 4: ctx.models 注册表

**Files:**
- Create: `packages/models/package.json`
- Create: `packages/models/src/kinds.ts`
- Create: `packages/models/src/errors.ts`
- Create: `packages/models/src/registry.ts`
- Create: `packages/models/src/index.ts`
- Test: `packages/models/tests/registry.test.ts`

**Interfaces:**
- Consumes: `Context.provide` / `get`
- Produces:

```ts
export const MODEL_KINDS = [
  "chat", "omni", "asr", "tts", "t2i", "t2v", "embedding", "rerank", "guard",
] as const;
export type ModelKind = (typeof MODEL_KINDS)[number];

export class ModelKindMissingError extends Error {
  constructor(readonly kind: ModelKind) {
    super(`未配置 ${kind}`);
    this.name = "ModelKindMissingError";
  }
}

export interface ChatChunkText { type: "text"; text: string }
export interface ChatChunkToolCall { type: "tool_call"; id: string; name: string; args: unknown }
export interface ChatChunkError { type: "error"; message: string }
export type ChatChunk = ChatChunkText | ChatChunkToolCall | ChatChunkError;

export interface ChatRequest {
  messages: import("@flintloom/session").ChatMessage[];
  tools: { name: string; description: string; parameters: Record<string, unknown> }[];
}

export interface ChatProvider {
  stream(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatChunk>;
}

export type GuardDecision = "allow" | "deny" | "ask";
export interface GuardGateInput {
  tool: string;
  args: unknown;
  workspaceRoot: string;
  channel: string;
}
export interface GuardProvider {
  gate(input: GuardGateInput, signal: AbortSignal): Promise<GuardDecision>;
}

export class ModelRegistry {
  registerChat(id: string, provider: ChatProvider): Disposer
  registerGuard(id: string, provider: GuardProvider): Disposer
  setDefault(kind: ModelKind, id: string): void
  resolveChat(): ChatProvider
  resolveGuard(): GuardProvider | undefined
  snapshot(): { kind: ModelKind; defaultId: string | null; configured: boolean }[]
}
```

`resolveChat()`：没有 default `chat` 则抛 `ModelKindMissingError("chat")`。  
`resolveGuard()`：未配置返回 `undefined`，不抛错。  
禁止：`resolveChat` 在缺 chat 时去用其它 kind。  
`snapshot()` 对每个 `MODEL_KINDS` 一行，`configured` 表示该 kind 是否有 default。

Context 键：`ctx.provide("models", registry)`。

- [ ] **Step 1: 写失败测试**

三例：登记 chat 后 `resolveChat()` 返回同一对象；未登记时抛 `ModelKindMissingError` 且 `kind === "chat"`；`snapshot()` 里 `asr.configured === false` 且解析 asr 不能得到 chat。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run packages/models/tests/registry.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 registry**

内部 `Map<ModelKind, Map<string, unknown>>` + `defaults: Map<ModelKind, string>`。`resolveChat` 只读 `chat`。

- [ ] **Step 4: 跑测试确认通过**

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/models
git commit -m "feat: model registry with fail-closed kinds"
```

---

### Task 5: 工具注册、工作区闸门、guard

**Files:**
- Create: `packages/tools/package.json`（依赖 `@flintloom/models`、`@flintloom/kernel`）
- Create: `packages/tools/src/workspace.ts`
- Create: `packages/tools/src/types.ts`
- Create: `packages/tools/src/registry.ts`
- Create: `packages/tools/src/index.ts`
- Test: `packages/tools/tests/workspace.test.ts`
- Test: `packages/tools/tests/registry.test.ts`

**Interfaces:**
- Consumes: `ModelRegistry.resolveGuard`、`GuardGateInput`
- Produces:

```ts
export function resolveInside(workspaceRoot: string, inputPath: string): string
export class WorkspaceEscapeError extends Error {}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>, exec: ToolExec): Promise<string>;
}
export interface ToolExec {
  workspaceRoot: string;
  signal: AbortSignal;
  channel: string;
}
export class ToolRegistry {
  register(def: ToolDefinition): Disposer
  schemas(): { name: string; description: string; parameters: Record<string, unknown> }[]
  execute(
    name: string,
    args: Record<string, unknown>,
    exec: ToolExec,
    models: ModelRegistry,
  ): Promise<string>
}
```

`resolveInside`：`path.resolve(workspaceRoot, inputPath)` 再 `fs.realpathSync.native`（文件尚不存在时 realpath 父目录再拼叶子）。结果必须以 `workspaceRoot` 的 realpath 为前缀（Windows 比较用大小写不敏感 + 统一分隔符）。越界抛 `WorkspaceEscapeError`。

`execute` 顺序：1）工具必须已注册；2）若 `args.path` 为 string，先 `resolveInside`；3）`guard = models.resolveGuard()`，若存在则 `gate`；`deny` 则不调用 `def.execute`，返回文本 `guard denied: <tool>`；`ask` 在本刀视为 `deny` 并附 `ask not supported in slice 1`（桌面确认留给后续计划）；4）`def.execute`。

- [ ] **Step 1: 写失败测试**

`workspace.test.ts`：workspace 为临时目录，`../secret.txt` 必须抛 `WorkspaceEscapeError`；相对 `README.md` 返回落在根下的绝对路径。  
`registry.test.ts`：假工具 `touch` 计数调用次数；假 guard 返回 `deny` 时调用次数仍为 0。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run packages/tools/tests`
Expected: FAIL

- [ ] **Step 3: 实现 workspace + ToolRegistry**

- [ ] **Step 4: 跑测试确认通过**

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/tools
git commit -m "feat: workspace-gated tools with optional guard"
```

---

### Task 6: fs / grep / shell

**Files:**
- Create: `packages/fs/src/index.ts` 与 `package.json`、`tests/fs.test.ts`
- Create: `packages/grep/src/index.ts` 与 `package.json`、`tests/grep.test.ts`
- Create: `packages/shell/src/index.ts` 与 `package.json`、`tests/shell.test.ts`

**Interfaces:**
- Consumes: `ToolDefinition`、`resolveInside`、`ToolExec`
- Produces: `createFsTool(): ToolDefinition`（name `fs`）；`createGrepTool(): ToolDefinition`（name `grep`）；`createShellTool(): ToolDefinition`（name `shell`）

`fs` args：`{ action: "read" | "write" | "list"; path: string; content?: string }`。read 返回文件文本（上限 200_000 字符，超出截断并注明）；write 只写 `resolveInside` 后的路径；list 列目录名。

`grep` args：`{ pattern: string; path?: string }`。从 workspace 或子路径走文件，跳过 `node_modules` 与 `.git`，按行正则，最多 200 条命中。用 Node 实现，不依赖 ripgrep 二进制。

`shell` args：`{ command: string }`。`cwd` 为 workspaceRoot。超时 15_000ms。Windows 用 `cmd.exe /c`，posix 用 `/bin/sh -c`。stdout+stderr 合并，上限 50_000 字符。非 0 退出仍把输出当工具结果字符串返回（前面加 `exit <code>\n`），不抛给 loop。

- [ ] **Step 1: 写失败测试**

临时 workspace 写入 `hello.txt` 内容 `alpha`。`fs` read 得到 `alpha`。`grep` pattern `alp` 命中该文件。`shell` 跑 `echo flintloom-ok`（Windows 同样），输出含 `flintloom-ok`。另测 `fs` read `../x` 失败。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run packages/fs/tests packages/grep/tests packages/shell/tests`
Expected: FAIL

- [ ] **Step 3: 实现三个工具包**

每个包 `apply` 可选：导出 `createXTool` 即可，loop 组装时 `tools.register(createFsTool())`。

- [ ] **Step 4: 跑测试确认通过**

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/fs packages/grep packages/shell
git commit -m "feat: add workspace fs grep and shell tools"
```

---

### Task 7: runTurn

**Files:**
- Create: `packages/loop/package.json`
- Create: `packages/loop/src/run-turn.ts`
- Create: `packages/loop/src/index.ts`
- Test: `packages/loop/tests/run-turn.test.ts`

**Interfaces:**
- Consumes: `Session`、`ModelRegistry.resolveChat`、`ToolRegistry.schemas` / `execute`、`ChatMessage`、`ChatChunk`
- Produces:

```ts
export interface RunTurnInput {
  session: Session;
  text: string;
  models: ModelRegistry;
  tools: ToolRegistry;
  workspaceRoot: string;
  channel: string;
  signal: AbortSignal;
  onEvent?: (event: SessionEvent) => void;
}
export interface RunTurnResult {
  turnId: string;
  status: "ok" | "failed" | "cancelled";
}
export function runTurn(input: RunTurnInput): Promise<RunTurnResult>
```

行为：

1. `turnId = crypto.randomUUID()`，append `turn/start`、`user/message`。
2. `system` 消息固定一句：`You are FlintLoom, a real agent. Use tools to work in the workspace.`（不进用户口号配置）。
3. 循环最多 8 个 step：`deriveMessages()` + system 作为 `ChatRequest.messages`，`tools.schemas()` 作为 tools。
4. 消费 `stream`：text chunk 追加 `assistant/chunk` 并 `onEvent`；`tool_call` 则 append `tool/call`，`tools.execute`，append `tool/result`；`error` chunk 则 append `model/error`，status `failed`，结束。
5. 若该 step 没有任何 tool_call：把累计文本 append `assistant/message`，`turn/end` status `ok`。
6. `signal.aborted`：status `cancelled`，停止再请求模型。
7. `resolveChat` 抛 `ModelKindMissingError`：append `model/error`，status `failed`。

- [ ] **Step 1: 写失败测试（假 chat）**

假 `ChatProvider` 第一次 stream 只发一个 `tool_call`：`fs` / `{ action: "read", path: "README.md" }`；第二次 stream 发 text `summary-ok`。workspace 里放 `README.md` 内容 `title-one`。断言：最终 `status === "ok"`；`deriveMessages` 含 tool 结果且含 `title-one`；`assistant/message` 为 `summary-ok`。

第二个测试：不登记 chat，status `failed`，事件含 `model/error` kind `chat`。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run packages/loop/tests/run-turn.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 runTurn**

- [ ] **Step 4: 跑测试确认通过**

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/loop
git commit -m "feat: runTurn loop with fake chat and fs"
```

---

### Task 8: OpenAI 兼容 chat provider

**Files:**
- Create: `packages/models-chat/src/openai-compat.ts`
- Create: `packages/models-chat/src/index.ts`
- Create: `packages/models-chat/package.json`
- Test: `packages/models-chat/tests/openai-compat.test.ts`

**Interfaces:**
- Consumes: `ChatProvider`、`ChatRequest`、`ChatChunk`
- Produces: `createOpenAiCompatChat(opts: { baseUrl: string; apiKey: string; model: string }): ChatProvider`

请求：`POST ${baseUrl}/chat/completions`，header `Authorization: Bearer ${apiKey}`，body `stream: true`，`messages` 映射 role/content，`tools` 映射为 OpenAI function tools。  
解析 SSE `data: ` 行：`delta.content` → `{ type: "text" }`；`delta.tool_calls` 拼 name/arguments JSON → `{ type: "tool_call" }`；`data: [DONE]` 结束。HTTP 非 2xx → yield `{ type: "error", message }`。apiKey 不得出现在 error message 里。

- [ ] **Step 1: 写失败测试**

用 `http.createServer` 本地假服务，返回两行 SSE（一段 content `hi`，然后 `[DONE]`）。断言 stream 得到 `{ type: "text", text: "hi" }`。再测 401 得到 error chunk 且 message 不含密钥。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run packages/models-chat/tests/openai-compat.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 provider**

- [ ] **Step 4: 跑测试确认通过**

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/models-chat
git commit -m "feat: OpenAI-compatible streaming chat provider"
```

---

### Task 9: Host + CLI

**Files:**
- Create: `apps/host/src/token.ts`
- Create: `apps/host/src/server.ts`
- Create: `apps/host/src/index.ts`
- Create: `apps/host/tests/server.test.ts`
- Create: `apps/cli/src/bin.ts`
- Create: `apps/cli/package.json`（`"bin": { "flint": "./src/bin.ts" }` 开发期用 `tsx`）
- Create: `apps/cli/tests/cli.test.ts`
- Create: `apps/host/package.json`
- Modify: 根 `package.json` scripts：`"flint": "tsx apps/cli/src/bin.ts"`
- Modify: `flintloom.yml` 列出 session/models-chat/fs/grep/shell（host 启动时手工 `register`，本刀不做动态 import 插件扫描以外的最小组装函数）

**Interfaces:**
- Consumes: `runTurn`、`ModelRegistry`、`ToolRegistry`、`createFsTool` 等、`createOpenAiCompatChat`、`loadConfig`
- Produces:

```ts
export function loadOrCreateToken(homeDir: string): string
export function startHost(opts: {
  workspaceRoot: string;
  homeDir: string;
  port?: number;
}): Promise<{ url: string; close: () => Promise<void> }>
```

`loadOrCreateToken`：读 `homeDir/.flintloom/credentials` 的 JSON `{ "hostToken": string }`；没有则生成 `crypto.randomBytes(24).toString("hex")` 并写入目录权限默认。

HTTP：

- listen `127.0.0.1`，默认端口 `7331`。
- 所有 `/v1/*` 要求 header `Authorization: Bearer <hostToken>`，否则 401。
- `POST /v1/turns` body `{ sessionId: string, text: string }`，`Content-Type: text/event-stream`。每条 session 事件 `data: ${JSON.stringify(event)}\n\n`，结束再发 `{ type: "end", status }`。客户端断开则 `AbortController.abort()`。
- `GET /v1/sessions/:id` 返回 `{ events }`（本刀 session 存在进程内 Map）。
- `POST /v1/turns/:id/cancel` abort 该 turn 的 controller。
- `GET /v1/models` 返回 `registry.snapshot()`，无密钥。

组装：`createRuntime(workspaceRoot, homeDir)` 创建 Context、Session map、ModelRegistry、ToolRegistry，注册三个工具；若 `process.env.FLINTLOOM_API_KEY` 或 credentials 里 `chatApiKey` 存在，则 `registerChat("default", createOpenAiCompatChat({ baseUrl: process.env.FLINTLOOM_BASE_URL ?? "https://api.deepseek.com/v1", apiKey, model: process.env.FLINTLOOM_CHAT_MODEL ?? "deepseek-chat" }))` 并 `setDefault("chat", "default")`。无 key 时 host 仍能启动，但 turn 会 `failed`（符合「未配置 chat」）。

CLI `flint`：参数 `--workspace <dir>`（默认 `process.cwd()`）、其余拼接为 `text`。进程内调 `runTurn`（不强制先起 HTTP）。stdout 打印 assistant/message 文本，exit 0/1 按 status。

- [ ] **Step 1: 写失败测试**

host 测试：无 token 的 `GET /v1/models` 得 401；有 token 得 200 JSON 含 kind `chat`。  
CLI 测试：用假 chat 不经过网络——在 `cli.test.ts` 里直接调 `runTurn` 已在 Task 7 覆盖；此处测 `loadOrCreateToken` 两次调用返回同一 token。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run apps/host/tests apps/cli/tests`
Expected: FAIL

- [ ] **Step 3: 实现 token、server、bin**

用 Node `http` 模块，不引入 Express。SSE 手动写。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test`
Expected: 全仓 PASS

- [ ] **Step 5: Commit**

```bash
git add apps/host apps/cli flintloom.yml package.json
git commit -m "feat: local host SSE and flint CLI for one coding turn"
```

---

## Self-review

**Spec coverage（第一刀）**

| Spec | 任务 |
|---|---|
| Kernel / yml / 可卸载插件 | Task 1–2 |
| Session log、模型可见可重建 | Task 3、7 |
| ctx.models kinds、缺 kind 失败 | Task 4 |
| guard 接口 + deny 不执行 | Task 5 |
| fs/grep/shell + 工作区 | Task 6 |
| runTurn | Task 7 |
| OpenAI 兼容 chat | Task 8 |
| 127.0.0.1、token、SSE、CLI | Task 9 |
| GET /v1/models | Task 9 |

**刻意留给第 2–4 刀：** 桌面、DocForge/`doc_ingest`、知识库、A2UI、信息图、channel webhook/telegram、MCP、skill、`flint plugin add`、asr/tts/t2i/t2v/omni provider、guard `ask` 的桌面确认。

**类型：** `ChatMessage` 只在 session 定义；models 与 loop 从 `@flintloom/session` 引用。`GuardDecision` 只在 models。`runTurn` 的 `onEvent` 使用 `SessionEvent`。
