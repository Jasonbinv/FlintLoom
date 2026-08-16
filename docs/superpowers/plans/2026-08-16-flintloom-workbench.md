# FlintLoom 浏览器工作台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pnpm desktop` 后浏览器打开 `http://127.0.0.1:5173`，发一句话，经现有 host SSE 看到用户/工具/助手气泡。

**Architecture:** Vite 只绑 `127.0.0.1:5173`。Node 中间件把 `/v1/*` 转到 `127.0.0.1:7331` 并补 `hostToken`。页面不直连 7331、不持有 token。host 已存在则 Bearer 探测后复用，否则 `startHost`。

**Tech Stack:** React 18、Vite 6、Vitest、jsdom（仅 App 测试）、tsx。不引入 Express、`http-proxy`、dataagent-v3、deepseek-harness。

## Global Constraints

- 口号与产品名：FlintLoom，A real agent. / 真正的 Agent。
- 包名前缀：`@flintloom/*`。
- 只绑定 `127.0.0.1`；host 默认端口 `7331`；Vite 端口 `5173`。
- `hostToken` 与模型 key 不得进入页面 HTML / bundle / 气泡。
- 不 import、不 submodule、不拷贝 dataagent-v3 或 deepseek-harness。
- 不改 `runTurn` 语义。不做 Electron、预览、知识库、DocForge、A2UI。
- 测试夹具不依赖真实 API key。
- Windows 提交用 Git Bash；PowerShell 不要用 `&&` 或带 `<` 的 commit trailer。

Spec：`docs/superpowers/specs/2026-08-16-flintloom-workbench-design.md`

## File map

```text
.env.example
.gitignore
apps/host/src/listen.ts
apps/host/src/server.ts          # 已有 .env 加载则本计划 Task 1 只提交
apps/desktop/package.json
apps/desktop/index.html
apps/desktop/tsconfig.json
apps/desktop/vite.config.ts
apps/desktop/src/types.ts
apps/desktop/src/sse.ts
apps/desktop/src/api.ts
apps/desktop/src/probe.ts
apps/desktop/src/proxy.ts
apps/desktop/src/App.tsx
apps/desktop/src/main.tsx
apps/desktop/src/app.css
apps/desktop/tests/sse.test.ts
apps/desktop/tests/probe.test.ts
apps/desktop/tests/App.test.tsx
scripts/desktop-dev.ts
package.json
vitest.config.ts
tsconfig.json
```

---

### Task 1: 提交 host `.env` 加载与 `listen.ts`

**Files:**
- Modify: `apps/host/src/server.ts`（若尚未读取工作区 `.env`：进程 env > `.env` > credentials `chatApiKey`）
- Create: `apps/host/src/listen.ts`（若尚无）
- Create: `.env.example`
- Modify: `.gitignore`（含 `.env`、`.env.local`）
- Test: `apps/host/tests/server.test.ts`（「registers chat from workspace .env」）

**Interfaces:**
- Consumes: `createRuntime(workspaceRoot, homeDir)`、`startHost`
- Produces: 工作区 `.env` 可配置 `FLINTLOOM_API_KEY` / `FLINTLOOM_BASE_URL` / `FLINTLOOM_CHAT_MODEL`；`pnpm exec tsx apps/host/src/listen.ts` 只起 host

`listen.ts`：

```ts
import { homedir } from "node:os";
import { startHost } from "./index.ts";

const { url } = await startHost({
  workspaceRoot: process.cwd(),
  homeDir: homedir(),
});
console.log(`FlintLoom listening ${url}`);
```

`.env.example` 以 DashScope 为例（key 用占位 `sk-xxx`），与现有文件一致即可。

- [ ] **Step 1:** 确认 `apps/host/tests/server.test.ts` 含 `.env` 用例（无进程 env 时 `chat.configured === true`）。

- [ ] **Step 2:** Run: `pnpm exec vitest run apps/host/tests`

Expected: PASS（若 RED，按 spec §3 补 `readDotEnv` / `resolveChatApiKey`）。

- [ ] **Step 3:** Commit（不要 `git add .env`）

```bash
git add apps/host/src/server.ts apps/host/src/listen.ts apps/host/tests/server.test.ts .env.example .gitignore
git commit -m "feat: load workspace dotenv and add host listen entry"
```

---

### Task 2: SSE 行解析

**Files:**
- Create: `apps/desktop/package.json`
- Create: `apps/desktop/tsconfig.json`
- Create: `apps/desktop/src/types.ts`
- Create: `apps/desktop/src/sse.ts`
- Test: `apps/desktop/tests/sse.test.ts`

**Interfaces:**
- Consumes: host 的 `data: ${JSON.stringify(event)}\n\n`
- Produces:

```ts
export type TurnEnd = { type: "end"; status: "ok" | "failed" | "cancelled" };
export type WorkbenchEvent =
  | { type: "turn/start"; turnId: string }
  | { type: "turn/end"; turnId: string; status: "ok" | "failed" | "cancelled" }
  | { type: "user/message"; text: string }
  | { type: "assistant/chunk"; text: string }
  | { type: "assistant/message"; text: string }
  | { type: "tool/call"; callId: string; name: string; args: unknown }
  | { type: "tool/result"; callId: string; name: string; text: string }
  | { type: "model/error"; kind: string; message: string }
  | { type: "guard/decision"; tool: string; decision: "allow" | "deny" | "ask" }
  | TurnEnd;

export function parseSseBuffer(buffer: string): {
  events: WorkbenchEvent[];
  rest: string;
}
```

`package.json`：

```json
{
  "name": "@flintloom/desktop",
  "private": true,
  "type": "module",
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.18",
    "@types/react-dom": "^18.3.5",
    "@vitejs/plugin-react": "^4.3.4",
    "jsdom": "^26.1.0",
    "vite": "^6.3.5"
  }
}
```

`tsconfig.json`：extends `../../tsconfig.base.json`，`jsx: react-jsx`，`noEmit: true`，include `src` 与 `tests`。

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from "vitest";
import { parseSseBuffer } from "../src/sse.ts";

describe("parseSseBuffer", () => {
  it("parses chunk then end", () => {
    const raw =
      `data: ${JSON.stringify({ type: "assistant/chunk", text: "hi" })}\n\n` +
      `data: ${JSON.stringify({ type: "end", status: "ok" })}\n\n`;
    const { events, rest } = parseSseBuffer(raw);
    expect(rest).toBe("");
    expect(events).toEqual([
      { type: "assistant/chunk", text: "hi" },
      { type: "end", status: "ok" },
    ]);
  });

  it("skips malformed data lines and keeps incomplete tail", () => {
    const raw = `data: not-json\n\ndata: {"type":"assistant/chunk","text":"a"}`;
    const { events, rest } = parseSseBuffer(raw);
    expect(events).toEqual([]);
    expect(rest.startsWith("data:")).toBe(true);
    const again = parseSseBuffer(rest + "\n\n");
    expect(again.events).toEqual([{ type: "assistant/chunk", text: "a" }]);
  });
});
```

- [ ] **Step 2:** Run: `pnpm exec vitest run apps/desktop/tests/sse.test.ts`

Expected: FAIL（模块不存在）。然后 `pnpm install`。

- [ ] **Step 3: 实现**

`parseSseBuffer`：按 `\n\n` 切开；最后一段当 `rest`；每块里找 `data: ` 前缀；`JSON.parse` 失败则跳过该行。

- [ ] **Step 4:** Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop package.json pnpm-lock.yaml
git commit -m "feat: parse workbench SSE data lines"
```

（若 lockfile 因 install 变化则一并提交。）

---

### Task 3: 7331 探测与 `/v1` 代理

**Files:**
- Create: `apps/desktop/src/probe.ts`
- Create: `apps/desktop/src/proxy.ts`
- Test: `apps/desktop/tests/probe.test.ts`

**Interfaces:**
- Consumes: `loadOrCreateToken`、`startHost`（本任务测试用假 HTTP，不强制起真 host）
- Produces:

```ts
export class PortInUseError extends Error {
  constructor() {
    super("port 7331 in use");
    this.name = "PortInUseError";
  }
}

export async function probeHost(opts: {
  origin: string;
  token: string;
  fetchImpl?: typeof fetch;
}): Promise<"missing" | "ours" | "foreign">

export async function ensureHost(opts: {
  origin?: string;
  token: string;
  start: () => Promise<void>;
  fetchImpl?: typeof fetch;
}): Promise<void>
```

`probeHost`：`fetch(origin + "/v1/models")` 无 Authorization。抛网络错 → `"missing"`。`status === 401` 再带 `Bearer ${token}` GET：200 → `"ours"`，其它 → `"foreign"`。无 401 且非网络错 → `"foreign"`。

`ensureHost`：`missing` 则 `await start()`；`ours` 则 return；`foreign` 则 throw `PortInUseError`。

代理（供 Vite 用，本任务用假上游测）：

```ts
export async function forwardV1(opts: {
  upstreamOrigin: string;
  token: string;
  method: string;
  path: string;
  body?: Buffer;
}): Promise<{ status: number; contentType: string | null; stream: ReadableStream<Uint8Array> | null }>
```

`path` 必须以 `/v1/` 开头。`fetch(upstreamOrigin + path, { method, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body })`。返回 status、Content-Type、body stream。

- [ ] **Step 1: 写失败测试**

用 `http.createServer`：无 token 的 `/v1/models` → 401；有正确 Bearer → 200 `[]`。断言 `probeHost` 为 `ours`；错误 token 为 `foreign`；关停服务器后为 `missing`。`ensureHost` 在 `missing` 时调用 `start` 一次。

再起一个上游，`forwardV1` GET `/v1/models` 必须带 `Authorization: Bearer secret`，响应 200。

- [ ] **Step 2:** Run: `pnpm exec vitest run apps/desktop/tests/probe.test.ts`

Expected: FAIL

- [ ] **Step 3: 实现 probe.ts 与 proxy.ts**

- [ ] **Step 4:** Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/probe.ts apps/desktop/src/proxy.ts apps/desktop/tests/probe.test.ts
git commit -m "feat: probe local host and forward /v1 with bearer"
```

---

### Task 4: 工作台 UI

**Files:**
- Create: `apps/desktop/src/api.ts`
- Create: `apps/desktop/src/App.tsx`
- Create: `apps/desktop/src/app.css`
- Create: `apps/desktop/src/main.tsx`
- Create: `apps/desktop/index.html`
- Test: `apps/desktop/tests/App.test.tsx`

**Interfaces:**
- Consumes: `parseSseBuffer`、`WorkbenchEvent`
- Produces: React `App`

`api.ts` 只打相对路径 `/v1/...`（由 Vite 代理）。

```ts
export async function fetchModels(signal?: AbortSignal): Promise<{ kind: string; configured: boolean }[]>
export async function fetchSession(sessionId: string): Promise<{ events: WorkbenchEvent[] } | undefined>
export async function cancelTurn(turnId: string): Promise<void>
export async function postTurn(
  sessionId: string,
  text: string,
  onEvent: (event: WorkbenchEvent) => void,
  signal?: AbortSignal,
): Promise<void>
```

`postTurn`：`fetch("/v1/turns", { method: "POST", headers: { "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify({ sessionId, text }), signal })`。用 `getReader` + `TextDecoder` 喂 `parseSseBuffer`。`fetch` 抛错或非 ok（且非 200 SSE）则 `onEvent({ type: "model/error", kind: "chat", message: "host unreachable" })`。

`App.tsx` 行为（必须遵守）：

- `sessionStorage` 键 `flintloom.sessionId`：无则 `crypto.randomUUID()`。
- mount：`fetchModels`；失败顶栏文案 `host 未连接`。成功则看 `kind === "chat"` 的 `configured`。
- mount：`fetchSession`；200 则按事件渲染（**包含**历史 `user/message`）；404 忽略。
- 发送：trim 空串忽略；本地插入 `{ type: "user/message", text }`；`sending=true`；`postTurn`；该轮 SSE `user/message` **丢弃**；`assistant/chunk` 拼到草稿；`assistant/message` 定稿并清空草稿；`tool/call` 显示 `name` + `JSON.stringify(args).slice(0, 200)`；`tool/result` 文本 `slice(0, 2000)`，超长加 `…`；`model/error` 显示 `message`；`turn/start` 记下 `turnId`；`type === "end"` 则 `sending=false`。
- Enter 发送，Shift+Enter 换行。
- 发送中按钮「取消」：有 `turnId` 则 `cancelTurn`；尚未有 id 则等 `turn/start` 后再 cancel。
- 深色主题，顶栏标题 `FlintLoom`。

`index.html`：`#root`，script `src/main.tsx`。`main.tsx`：`createRoot` 渲染 `App`。

`App.test.tsx` 文件首行：`/** @vitest-environment jsdom */`

夹具：mock `globalThis.fetch`。`GET /v1/models` → `[{ kind: "chat", configured: false }]`。`GET /v1/sessions/...` → 404。`POST /v1/turns` → 200，body 为：

```
data: {"type":"assistant/chunk","text":"hi"}

data: {"type":"assistant/message","text":"hello"}

data: {"type":"end","status":"ok"}

```

断言文档含 `hello`。第二例 POST 体为 `model/error` `kind: chat` `message: missing`，断言含 `missing`。

- [ ] **Step 1: 写失败测试**（上述两例）

- [ ] **Step 2:** Run: `pnpm exec vitest run apps/desktop/tests/App.test.tsx`

Expected: FAIL

- [ ] **Step 3: 实现 App / api / css / main / html**

- [ ] **Step 4:** Expected: PASS。再 `pnpm test` 全绿。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop
git commit -m "feat: render workbench bubbles from SSE fixtures"
```

---

### Task 5: `pnpm desktop` 启动链

**Files:**
- Create: `apps/desktop/vite.config.ts`
- Create: `scripts/desktop-dev.ts`
- Modify: 根 `package.json` scripts `"desktop": "tsx scripts/desktop-dev.ts"`
- Modify: 根 `vitest.config.ts` include 增加 `apps/**/tests/**/*.test.tsx`
- Modify: 根 `tsconfig.json` include 增加 `apps/*/src/**/*.tsx`、`apps/*/tests/**/*.tsx`

**Interfaces:**
- Consumes: `ensureHost`、`forwardV1`、`loadOrCreateToken`、`startHost`
- Produces: `pnpm desktop`

`vite.config.ts`：`plugins: [react()]`；`server: { host: "127.0.0.1", port: 5173, strictPort: true }`；`configureServer`：对 `url.startsWith("/v1/")` 调用 `forwardV1`（token 闭包来自 `loadOrCreateToken(homedir())`），把 stream 写入 Connect `res`，设置 `Content-Type`。非 `/v1/` `next()`。

`scripts/desktop-dev.ts`：

```ts
import { homedir } from "node:os";
import { createServer } from "vite";
import { loadOrCreateToken, startHost } from "@flintloom/host";
import { ensureHost } from "../apps/desktop/src/probe.ts";

const token = loadOrCreateToken(homedir());
await ensureHost({
  origin: "http://127.0.0.1:7331",
  token,
  start: async () => {
    await startHost({
      workspaceRoot: process.cwd(),
      homeDir: homedir(),
      port: 7331,
    });
  },
});
const vite = await createServer({
  configFile: "apps/desktop/vite.config.ts",
  root: "apps/desktop",
});
await vite.listen();
vite.printUrls();
```

`apps/host/package.json` 无需改 exports。desktop-dev 从仓库根运行。`@flintloom/desktop` 的 `package.json` 加 `"@flintloom/host": "workspace:*"` 仅当 vite 插件 import host 时需要；**token 读取放在 `desktop-dev.ts` 与 `vite.config.ts`**。`vite.config.ts` 可 import `@flintloom/host`：给 `apps/desktop/package.json` 加 workspace 依赖 `@flintloom/host`。

- [ ] **Step 1:** 改 vitest/tsconfig include；`pnpm exec vitest run apps/desktop/tests` 仍 PASS。

- [ ] **Step 2:** 实现 vite.config.ts 与 desktop-dev.ts；根脚本 `desktop`。

- [ ] **Step 3:** `pnpm test` 全仓 PASS；`pnpm typecheck` PASS。

- [ ] **Step 4:** 手工：`pnpm desktop`，浏览器 `http://127.0.0.1:5173` 应出 FlintLoom 顶栏（无 key 时 chat 未配置仍可发送并看到 `model/error`）。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/vite.config.ts apps/desktop/package.json scripts/desktop-dev.ts package.json vitest.config.ts tsconfig.json pnpm-lock.yaml
git commit -m "feat: pnpm desktop starts host proxy and vite workbench"
```

---

## Self-review

**Spec coverage**

| Spec | 任务 |
|---|---|
| 工作区 `.env` | Task 1 |
| SSE 解析 / 坏行跳过 | Task 2 |
| 7331 复用 / `port 7331 in use` | Task 3 |
| `/v1` Bearer 代理 | Task 3、5 |
| 气泡、乐观用户消息、丢弃 SSE user/message | Task 4 |
| session 刷新 GET | Task 4 |
| 取消 | Task 4 |
| `pnpm desktop` 127.0.0.1:5173 | Task 5 |
| 夹具测试不依赖 API key | Task 2、4 |
| 不引入 Express / http-proxy | 全任务 |

**Placeholder scan:** 无 TBD。`forwardV1` 的 Connect 写入细节在 Task 5 用 `Readable.toWeb` / `for await` 把 Uint8Array `res.write`。

**类型：** `WorkbenchEvent` 在 Task 2 定义；Task 4 `onEvent` 使用同一类型。
