# FlintLoom 联网搜索 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Composer 粘性「联网」开关控制本轮是否把 `web_search` 交给模型；后端可配 SearXNG / Tavily / Brave / 博查；关则看不到也调不了该工具。

**Architecture:** 新插件 `@flintloom/web-search` 始终登记 `web_search`。`runTurn` 按 `webSearch` 过滤 schema，并把标志写入 `turn/start` 供续跑。Host 用分层 env 填 `runtimeConfigById["web-search"]`。桌面只多一个开关和第 6 个 `postTurn` 参数。不引入 `web_fetch`。

**Tech Stack:** 现有 kernel 插件、`fetch` + 可注入假实现、Vitest、React 工作台。不引入搜索 SDK。

## Global Constraints

- 产品名 FlintLoom；包前缀 `@flintloom/*`。
- 禁止 `createRuntime` 里 `register(web_search)`；host `src` 不得出现 `@flintloom/web-search`（连 `import type` 也不要）。
- 测试禁止访问公网；provider 测试必须注入 `fetch`。
- 失败字符串：`failed: search not configured` / `failed: empty query` / `failed: timeout` / `failed: search <status>` / `failed: web_search disabled` / `aborted` / `No results.` / `failed: search`。
- API key 不得进入 `tool/result`、session 事件、日志。
- CLI / webhook 等通道不传 `webSearch`（默认关）。
- Windows 提交指定文件；不要 `git add -A`。用户未要求提交时可跳过各 Task 的 commit 步。

Spec：`docs/superpowers/specs/2026-08-29-flintloom-web-search-design.md`

## File map

```text
packages/web-search/package.json
packages/web-search/src/types.ts
packages/web-search/src/search.ts          # resolveSearchProvider + searchWeb
packages/web-search/src/format.ts          # hits → tool text
packages/web-search/src/tool.ts            # createWebSearchTool
packages/web-search/src/index.ts           # default plugin
packages/web-search/tests/search.test.ts
packages/web-search/tests/format.test.ts
packages/web-search/tests/tool.test.ts
packages/web-search/tests/plugin.test.ts

packages/tools/src/types.ts                # ToolExec.webSearch?
packages/session/src/events.ts             # turn/start.webSearch?
packages/loop/src/run-turn.ts              # 过滤 schema、system hint、execute 透传

apps/host/src/turn-body.ts
apps/host/src/server.ts                    # overlay + runTurn.webSearch
apps/host/tests/turn-body.test.ts
apps/host/tests/assembly.ts
apps/host/tests/server.test.ts
flintloom.yml
package.json                               # devDependency

apps/desktop/src/api.ts
apps/desktop/src/WebSearchToggle.tsx
apps/desktop/src/App.tsx
apps/desktop/src/toolDisplay.ts
apps/desktop/tests/App.test.tsx
apps/desktop/tests/toolDisplay.test.ts
.env.example
```

yml 插在 `shell` 之后、`knowledge` 之前。

---

### Task 1: `searchWeb` 四后端 + 假 fetch

**Files:**
- Create: `packages/web-search/package.json`
- Create: `packages/web-search/src/types.ts`
- Create: `packages/web-search/src/search.ts`
- Create: `packages/web-search/tests/search.test.ts`
- Modify: `package.json`（根 `devDependencies` 加 `"@flintloom/web-search": "workspace:*"`）

**Interfaces:**
- Consumes: 无
- Produces: `SearchConfig`, `SearchHit`, `SearchOutcome`, `resolveSearchProvider(config)`, `searchWeb(config, args, signal)`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from "vitest";
import { resolveSearchProvider, searchWeb, type SearchConfig } from "../src/search.ts";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("resolveSearchProvider", () => {
  it("uses explicit provider when its credential exists", () => {
    expect(
      resolveSearchProvider({
        provider: "brave",
        braveApiKey: "b",
        tavilyApiKey: "t",
      }),
    ).toBe("brave");
  });

  it("returns undefined when explicit provider is missing credential", () => {
    expect(resolveSearchProvider({ provider: "tavily", braveApiKey: "b" })).toBeUndefined();
  });

  it("auto-picks searxng then tavily then brave then bocha", () => {
    expect(resolveSearchProvider({ tavilyApiKey: "t", braveApiKey: "b" })).toBe("tavily");
    expect(resolveSearchProvider({ searxngUrl: "http://127.0.0.1:8080/" })).toBe("searxng");
  });
});

describe("searchWeb", () => {
  it("maps searxng json and strips trailing slash", async () => {
    const seen: string[] = [];
    const config: SearchConfig = {
      searxngUrl: "http://127.0.0.1:8080/",
      fetch: async (input) => {
        seen.push(String(input));
        return jsonResponse(200, {
          results: [{ title: "Hello", url: "https://ex.test/", content: "snippet" }],
        });
      },
    };
    const out = await searchWeb(config, { query: "hello", count: 3 }, new AbortController().signal);
    expect(out).toEqual({
      ok: true,
      hits: [{ title: "Hello", url: "https://ex.test/", snippet: "snippet" }],
    });
    expect(seen[0]).toContain("http://127.0.0.1:8080/search?");
    expect(seen[0]).not.toContain("8080//");
    expect(seen[0]).not.toContain("language=");
  });

  it("sets SearXNG language=zh-CN for CJK queries", async () => {
    const seen: string[] = [];
    await searchWeb(
      {
        searxngUrl: "http://127.0.0.1:8080",
        fetch: async (input) => {
          seen.push(String(input));
          return jsonResponse(200, { results: [] });
        },
      },
      { query: "今天天气", count: 5 },
      new AbortController().signal,
    );
    expect(seen[0]).toContain("language=zh-CN");
  });

  it("maps tavily / brave / bocha hits", async () => {
    const tavily = await searchWeb(
      {
        tavilyApiKey: "tv",
        fetch: async (_input, init) => {
          const body = JSON.parse(String(init?.body)) as { api_key: string; max_results: number };
          expect(body.api_key).toBe("tv");
          expect(body.max_results).toBe(2);
          return jsonResponse(200, {
            results: [{ title: "T", url: "https://t.test", content: "tc" }],
          });
        },
      },
      { query: "q", count: 2 },
      new AbortController().signal,
    );
    expect(tavily).toEqual({
      ok: true,
      hits: [{ title: "T", url: "https://t.test", snippet: "tc" }],
    });

    const brave = await searchWeb(
      {
        braveApiKey: "br",
        fetch: async (input, init) => {
          expect(String(input)).toContain("api.search.brave.com");
          expect((init?.headers as Record<string, string>)["X-Subscription-Token"]).toBe("br");
          return jsonResponse(200, {
            web: { results: [{ title: "B", url: "https://b.test", description: "bd" }] },
          });
        },
      },
      { query: "q", count: 5 },
      new AbortController().signal,
    );
    expect(brave.ok && brave.hits[0]?.snippet).toBe("bd");

    const bocha = await searchWeb(
      {
        bochaApiKey: "bo",
        fetch: async (_input, init) => {
          expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer bo");
          return jsonResponse(200, {
            data: {
              webPages: { value: [{ name: "Z", url: "https://z.test", snippet: "zs" }] },
            },
          });
        },
      },
      { query: "天气", count: 5 },
      new AbortController().signal,
    );
    expect(bocha).toEqual({
      ok: true,
      hits: [{ title: "Z", url: "https://z.test", snippet: "zs" }],
    });
  });

  it("returns failed: search not configured and failed: search 403", async () => {
    expect(await searchWeb({}, { query: "q", count: 5 }, new AbortController().signal)).toEqual({
      ok: false,
      error: "failed: search not configured",
    });
    const forbidden = await searchWeb(
      {
        tavilyApiKey: "tv",
        fetch: async () => jsonResponse(403, { error: "no" }),
      },
      { query: "q", count: 5 },
      new AbortController().signal,
    );
    expect(forbidden).toEqual({ ok: false, error: "failed: search 403" });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run packages/web-search/tests/search.test.ts`

Expected: FAIL（模块不存在）

- [ ] **Step 3: 最小实现**

`packages/web-search/package.json`:

```json
{
  "name": "@flintloom/web-search",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@flintloom/kernel": "workspace:*",
    "@flintloom/tools": "workspace:*"
  }
}
```

根 `package.json` `devDependencies` 按字母序插入 `"@flintloom/web-search": "workspace:*"`。然后在 FlintLoom 根执行 `pnpm install`。

`types.ts`：

```ts
export type SearchProviderId = "searxng" | "tavily" | "brave" | "bocha";

export type SearchConfig = {
  provider?: SearchProviderId;
  searxngUrl?: string;
  tavilyApiKey?: string;
  braveApiKey?: string;
  bochaApiKey?: string;
  fetch?: typeof fetch;
};

export type SearchHit = { title: string; url: string; snippet: string };

export type SearchOutcome =
  | { ok: true; hits: SearchHit[] }
  | { ok: false; error: string };

export type SearchArgs = { query: string; count: number };
```

`search.ts` 要点（写完整文件，勿留半截）：

- `SEARCH_TIMEOUT_MS = 12_000`
- `hasCjk(q)` = `/[\u3400-\u9fff]/.test(q)`
- `stripSlash(url)` 去尾 `/`
- `resolveSearchProvider`：若 `config.provider` 有值，仅当对应凭证齐全才返回该 id，否则 `undefined`。凭证：searxng=`searxngUrl`，其余为对应 ApiKey。无 provider 时按 searxng → tavily → brave → bocha。
- `searchWeb`：`provider = resolveSearchProvider(config)`；无则 `{ ok:false, error:"failed: search not configured" }`。
- `AbortSignal.any([signal, AbortSignal.timeout(12000)])`。catch 里：`signal.aborted` → `aborted`；否则若 timeout → `failed: timeout`；其它 → `failed: search`。
- HTTP `!res.ok` → `failed: search ${res.status}`。
- JSON 非预期 / 空数组：`ok:true, hits:[]`（零命中由工具层变成 `No results.`）。
- 字段映射：
  - searxng `results[]` → title/url/content
  - tavily `results[]` → title/url/content；POST `https://api.tavily.com/search` body `{ api_key, query, max_results: count, search_depth: "basic" }`
  - brave `web.results[]` → title/url/description；GET `https://api.search.brave.com/res/v1/web/search?q=&count=` header `X-Subscription-Token`
  - bocha `data.webPages.value[]` → name/url/snippet；POST `https://api.bochaai.com/v1/web-search` header `Authorization: Bearer` body `{ query, count, summary: true }`
- 每条 hit 缺 title/url 则跳过。snippet 截到 240。hits 截到 `count`。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run packages/web-search/tests/search.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**（用户未要求则跳过）

```bash
git add packages/web-search/package.json packages/web-search/src/types.ts packages/web-search/src/search.ts packages/web-search/tests/search.test.ts package.json pnpm-lock.yaml
git commit -m "feat(web-search): add searchable providers behind injectable fetch"
```

---

### Task 2: `web_search` 工具 + 插件

**Files:**
- Create: `packages/web-search/src/format.ts`
- Create: `packages/web-search/src/tool.ts`
- Create: `packages/web-search/src/index.ts`
- Create: `packages/web-search/tests/format.test.ts`
- Create: `packages/web-search/tests/tool.test.ts`
- Create: `packages/web-search/tests/plugin.test.ts`

**Interfaces:**
- Consumes: `searchWeb`, `SearchConfig`
- Produces: `formatSearchHits(hits)`, `createWebSearchTool(config)`, default plugin `name: "@flintloom/web-search"`

- [ ] **Step 1: 写失败测试**

`format.test.ts`：两条 hit 格式为编号+title/url/snippet；空数组返回 `No results.`；总长 > 8000 截断。

`tool.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { createWebSearchTool } from "../src/tool.ts";

const exec = {
  workspaceRoot: ".",
  signal: new AbortController().signal,
  channel: "host",
  webSearch: true,
};

describe("createWebSearchTool", () => {
  it("rejects when webSearch is not true", async () => {
    const tool = createWebSearchTool({ tavilyApiKey: "tv", fetch: async () => new Response("{}") });
    expect(await tool.execute({ query: "q" }, { ...exec, webSearch: false })).toBe(
      "failed: web_search disabled",
    );
    expect(await tool.execute({ query: "q" }, { ...exec, webSearch: undefined })).toBe(
      "failed: web_search disabled",
    );
  });

  it("rejects empty query", async () => {
    const tool = createWebSearchTool({ searxngUrl: "http://127.0.0.1:8080" });
    expect(await tool.execute({ query: "  " }, exec)).toBe("failed: empty query");
  });

  it("formats hits when search succeeds", async () => {
    const tool = createWebSearchTool({
      tavilyApiKey: "tv",
      fetch: async () =>
        new Response(
          JSON.stringify({
            results: [{ title: "A", url: "https://a.test", content: "aa" }],
          }),
        ),
    });
    const text = await tool.execute({ query: "hello", count: 5 }, exec);
    expect(text).toContain("1. A");
    expect(text).toContain("https://a.test");
    expect(text).toContain("aa");
  });
});
```

`plugin.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { Context } from "@flintloom/kernel";
import modelsPlugin from "@flintloom/models";
import toolsPlugin, { type ToolRegistry } from "@flintloom/tools";
import plugin from "../src/index.ts";

describe("web-search plugin", () => {
  it("registers web_search", () => {
    const ctx = new Context();
    ctx.plugin(modelsPlugin);
    ctx.plugin(toolsPlugin);
    ctx.plugin(plugin);
    const names = ctx.require<ToolRegistry>("tools").schemas().map((s) => s.name);
    expect(names).toContain("web_search");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run packages/web-search/tests/format.test.ts packages/web-search/tests/tool.test.ts packages/web-search/tests/plugin.test.ts`

Expected: FAIL

- [ ] **Step 3: 实现**

`format.ts`：`formatSearchHits(hits: SearchHit[]): string` — 空 → `No results.`；否则

```
1. ${title}
   ${url}
   ${snippet}
```

行间空行可选，但测试用 `toContain`。拼完若 `length > 8000` 则 `slice(0, 8000)`。

`tool.ts`：`createWebSearchTool(config: SearchConfig): ToolDefinition`

- name `web_search`
- description 用 spec 原文
- parameters：`query` required string；`count` integer 1–8
- execute：`exec.webSearch !== true` → `failed: web_search disabled`。`query` 必须是 string，trim 后空 → `failed: empty query`；长度 > 200 则 slice 到 200。`count` 非 1–8 的整数则用 5。调用 `searchWeb`；`!ok` 返回 `outcome.error`；否则 `formatSearchHits`。

`index.ts`：

```ts
import type { Context, FlintPlugin } from "@flintloom/kernel";
import type { ToolRegistry } from "@flintloom/tools";
import { createWebSearchTool } from "./tool.ts";
import type { SearchConfig, SearchProviderId } from "./types.ts";

function asConfig(raw: Record<string, unknown>): SearchConfig {
  const provider = raw.provider;
  const ids = new Set(["searxng", "tavily", "brave", "bocha"]);
  return {
    provider: typeof provider === "string" && ids.has(provider) ? (provider as SearchProviderId) : undefined,
    searxngUrl: typeof raw.searxngUrl === "string" ? raw.searxngUrl : undefined,
    tavilyApiKey: typeof raw.tavilyApiKey === "string" ? raw.tavilyApiKey : undefined,
    braveApiKey: typeof raw.braveApiKey === "string" ? raw.braveApiKey : undefined,
    bochaApiKey: typeof raw.bochaApiKey === "string" ? raw.bochaApiKey : undefined,
  };
}

const plugin: FlintPlugin = {
  name: "@flintloom/web-search",
  apply(ctx: Context, config: Record<string, unknown>) {
    const tools = ctx.require<ToolRegistry>("tools");
    ctx.effect(tools.register(createWebSearchTool(asConfig(config))));
  },
};

export { createWebSearchTool } from "./tool.ts";
export { searchWeb, resolveSearchProvider } from "./search.ts";
export { formatSearchHits } from "./format.ts";
export default plugin;
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run packages/web-search/tests`

Expected: PASS

- [ ] **Step 5: Commit**（用户未要求则跳过）

```bash
git add packages/web-search
git commit -m "feat(web-search): register web_search tool"
```

---

### Task 3: 按轮过滤 schema + `ToolExec.webSearch`

**Files:**
- Modify: `packages/tools/src/types.ts`
- Modify: `packages/session/src/events.ts`
- Modify: `packages/loop/src/run-turn.ts`
- Modify: `packages/loop/tests/run-turn.test.ts`

**Interfaces:**
- Consumes: `ToolDefinition.name === "web_search"`
- Produces: `RunTurnInput.webSearch?: boolean`；`turn/start.webSearch?: boolean`；`ToolExec.webSearch?: boolean`；`conversationSystemMessage(webSearch: boolean)`（可放在 `run-turn.ts` 不导出）

- [ ] **Step 1: 写失败测试**（加在 `run-turn.test.ts`）

注册一个假 `web_search` 工具（execute 返回 `"searched"`）。假 chat 的 `stream(req)` 把 `req.tools.map(t => t.name)` 记下来，并检查 `req.messages[0].content`。

1. `runTurn` 不传 `webSearch`：tools 不含 `web_search`；system 不含 `web_search`。
2. `runTurn({ webSearch: true })`：tools 含 `web_search`；system 含 `You may call web_search`；session 事件里该 `turn/start` 的 `webSearch === true`。
3. 假 chat 在 `webSearch: false` 时仍 yield `tool_call` name `web_search`：`tool/result` 文本为 `failed: web_search disabled`（execute 必须带 `webSearch: false`）。为此把假工具写成：若 `exec.webSearch !== true` 返回 `failed: web_search disabled`，与真工具一致。

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run packages/loop/tests/run-turn.test.ts`

Expected: 新用例 FAIL

- [ ] **Step 3: 实现**

`ToolExec` 与 `ToolPreExecutePayload` 增加 `webSearch?: boolean`。

`SessionEvent` 的 `turn/start` 增加 `webSearch?: boolean`。

`run-turn.ts`：

```ts
function conversationSystemMessage(webSearch: boolean): string {
  const base = "You are FlintLoom, a real agent. Use tools to work in the workspace.";
  if (!webSearch) return base;
  return `${base}\nYou may call web_search when you need current or external information. Do not search for questions you can answer from the workspace or your knowledge.`;
}

function turnWebSearch(session: Session, turnId: string): boolean {
  for (const event of session.events()) {
    if (event.type === "turn/start" && event.turnId === turnId) {
      return event.webSearch === true;
    }
  }
  return false;
}
```

- `RunTurnInput` / `RunStepsInput` 加 `webSearch?: boolean`。
- `runTurn`：`const webSearch = input.webSearch === true`；`turn/start` 仅在 true 时带 `webSearch: true`；`runStepIterations({ ...input, webSearch })`。
- `continueTurn` / `continueGuardTurn`：`webSearch: turnWebSearch(session, turnId)` 传入 `runStepIterations` / `execute`。
- 替换模块常量 `SYSTEM_MESSAGE` 为 `conversationSystemMessage(input.webSearch === true)`。
- `tools.schemas().filter((s) => input.webSearch === true || s.name !== "web_search")`
- 两处 `tools.execute(..., { workspaceRoot, signal, channel, webSearch: input.webSearch === true, guardBypass? })`

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run packages/loop/tests/run-turn.test.ts packages/session/tests packages/tools/tests`

Expected: PASS（旧 `turn/start` 无该字段的测试仍过）

- [ ] **Step 5: Commit**（用户未要求则跳过）

```bash
git add packages/tools/src/types.ts packages/session/src/events.ts packages/loop/src/run-turn.ts packages/loop/tests/run-turn.test.ts
git commit -m "feat(loop): gate web_search on per-turn webSearch flag"
```

---

### Task 4: Host 解析 body、注入插件 config、yml

**Files:**
- Modify: `apps/host/src/turn-body.ts`
- Modify: `apps/host/tests/turn-body.test.ts`
- Modify: `apps/host/src/server.ts`
- Modify: `apps/host/tests/assembly.ts`
- Modify: `apps/host/tests/server.test.ts`
- Modify: `flintloom.yml`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `TurnBody.webSearch?: boolean`；plugin config 键名 `provider` `searxngUrl` `tavilyApiKey` `braveApiKey` `bochaApiKey`
- Produces: `loop.runTurn({ webSearch: body.webSearch })`；`runtimeConfigById["web-search"]`

- [ ] **Step 1: 写失败测试**

`turn-body.test.ts`：

```ts
it("accepts webSearch true", () => {
  expect(
    parseTurnBody(JSON.stringify({ sessionId: "s1", text: "hi", webSearch: true })),
  ).toEqual({ sessionId: "s1", text: "hi", webSearch: true });
});

it("rejects non-boolean webSearch", () => {
  expect(
    parseTurnBody(JSON.stringify({ sessionId: "s1", text: "hi", webSearch: "yes" })),
  ).toBeUndefined();
});
```

`server.test.ts`：

- `host src does not import tool factories` 增加 `expect(src).not.toMatch(/@flintloom\/web-search/);`
- `registers doc_probe and doc_parse tools` 增加 `expect(names).toContain("web_search");`
- 新用例：yml 去掉 web-search 行后 schema 不含 `web_search`：

```ts
  it("omitting web-search from yml omits web_search", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-host-noweb-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-host-home-"));
    writeFileSync(
      join(workspaceRoot, "flintloom.yml"),
      ASSEMBLY.replace(
        `  - id: web-search\n    name: "@flintloom/web-search"\n`,
        "",
      ),
    );
    const { ctx } = await createRuntime(workspaceRoot, homeDir);
    const names = ctx.require<ToolRegistry>("tools").schemas().map((s) => s.name);
    expect(names).not.toContain("web_search");
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run apps/host/tests/turn-body.test.ts apps/host/tests/server.test.ts`

Expected: 新断言 FAIL

- [ ] **Step 3: 实现**

`TurnBody` 加 `webSearch?: boolean`。`parseTurnBody`：若字段存在且不是 boolean → `undefined`；若 `true` 则放进返回值；`false` 可省略（与桌面不传字段一致）。

`createRuntime` 在 `runtimeConfigById.skill` 附近：

```ts
runtimeConfigById["web-search"] = {
  ...(resolveLayeredString("FLINTLOOM_SEARCH_PROVIDER", fileEnv, undefined).value
    ? { provider: resolveLayeredString("FLINTLOOM_SEARCH_PROVIDER", fileEnv, undefined).value }
    : {}),
  ...(resolveLayeredString("FLINTLOOM_SEARXNG_URL", fileEnv, undefined).value
    ? { searxngUrl: resolveLayeredString("FLINTLOOM_SEARXNG_URL", fileEnv, undefined).value }
    : {}),
  ...(resolveLayeredString("FLINTLOOM_TAVILY_API_KEY", fileEnv, undefined).value
    ? { tavilyApiKey: resolveLayeredString("FLINTLOOM_TAVILY_API_KEY", fileEnv, undefined).value }
    : {}),
  ...(resolveLayeredString("FLINTLOOM_BRAVE_API_KEY", fileEnv, undefined).value
    ? { braveApiKey: resolveLayeredString("FLINTLOOM_BRAVE_API_KEY", fileEnv, undefined).value }
    : {}),
  ...(resolveLayeredString("FLINTLOOM_BOCHA_API_KEY", fileEnv, undefined).value
    ? { bochaApiKey: resolveLayeredString("FLINTLOOM_BOCHA_API_KEY", fileEnv, undefined).value }
    : {}),
};
```

为免重复调用，抽局部变量。空对象也要赋给 `web-search`，这样 yml 有插件时 config 仍合法。

`POST /v1/turns`：`runTurn({ ..., webSearch: body.webSearch })`。

`flintloom.yml` 与 `ASSEMBLY` 在 shell 后插入：

```yaml
  - id: web-search
    name: "@flintloom/web-search"
```

`.env.example` 追加：

```bash
# Web search (composer 联网). Process env wins over this file.
# FLINTLOOM_SEARCH_PROVIDER=searxng
# FLINTLOOM_SEARXNG_URL=http://127.0.0.1:8080
# FLINTLOOM_TAVILY_API_KEY=
# FLINTLOOM_BRAVE_API_KEY=
# FLINTLOOM_BOCHA_API_KEY=
# Brave: set a spend cap in the API dashboard so the $5 credit does not overcharge.
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run apps/host/tests/turn-body.test.ts apps/host/tests/server.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**（用户未要求则跳过）

```bash
git add apps/host/src/turn-body.ts apps/host/src/server.ts apps/host/tests flintloom.yml .env.example
git commit -m "feat(host): wire webSearch turn flag and search plugin config"
```

---

### Task 5: 工作台「联网」开关

**Files:**
- Create: `apps/desktop/src/WebSearchToggle.tsx`
- Create: `apps/desktop/tests/toolDisplay.test.ts`
- Modify: `apps/desktop/src/api.ts`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/toolDisplay.ts`
- Modify: `apps/desktop/tests/App.test.tsx`

**Interfaces:**
- Consumes: `postTurn(..., webSearch?: boolean)`
- Produces: 粘性 `webSearch` state；仅 true 时 JSON 带字段

- [ ] **Step 1: 写失败测试**

`toolDisplay.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { toolDisplaySummary, toolDisplayTitle } from "../src/toolDisplay.ts";

describe("toolDisplay", () => {
  it("titles web_search as Web", () => {
    expect(toolDisplayTitle("web_search")).toBe("Web");
  });

  it("summarizes web_search by query", () => {
    expect(toolDisplaySummary("web_search", { query: "天气" })).toBe("天气");
  });
});
```

`App.test.tsx` 追加（使用文件里已有的 `installFetch` / `mountApp` / `waitForText` / `typeAndSend` / `requestUrl`）：

```ts
  it("shows a sticky web search toggle and sends webSearch only when on", async () => {
    installFetch();
    await mountApp();
    await waitForText("联网");
    const toggle = Array.from(
      document.querySelectorAll(".composer-tools button"),
    ).find((btn) => btn.textContent === "联网") as HTMLButtonElement | undefined;
    if (!toggle) throw new Error("no 联网 button");
    expect(toggle.className).not.toContain("composer-tool-btn--active");

    await act(async () => {
      toggle.click();
    });
    expect(toggle.className).toContain("composer-tool-btn--active");
    await typeAndSend("今天天气");
    await waitForText("hello");
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const turnCall = fetchMock.mock.calls.find(([input, init]) => {
      const url = requestUrl(input as RequestInfo | URL);
      return url.includes("/v1/turns") && (init as RequestInit | undefined)?.method === "POST";
    });
    const body = JSON.parse(String((turnCall![1] as RequestInit).body)) as {
      text: string;
      webSearch?: boolean;
    };
    expect(body.text).toBe("今天天气");
    expect(body.webSearch).toBe(true);

    await act(async () => {
      toggle.click();
    });
    await typeAndSend("第二轮");
    await waitForText("hello");
    const second = [...fetchMock.mock.calls].reverse().find(([input, init]) => {
      const url = requestUrl(input as RequestInfo | URL);
      return url.includes("/v1/turns") && (init as RequestInit | undefined)?.method === "POST";
    });
    const body2 = JSON.parse(String((second![1] as RequestInit).body)) as {
      webSearch?: boolean;
    };
    expect(body2).not.toHaveProperty("webSearch");
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run apps/desktop/tests/App.test.tsx apps/desktop/tests/toolDisplay.test.ts`

Expected: FAIL（无按钮 / title 不是 Web）

- [ ] **Step 3: 实现**

`api.ts`：

```ts
export async function postTurn(
  sessionId: string,
  text: string,
  onEvent: (event: WorkbenchEvent) => void,
  signal?: AbortSignal,
  images?: UserImage[],
  webSearch?: boolean,
): Promise<void> {
  const body: Record<string, unknown> = { sessionId, text };
  if (images !== undefined && images.length > 0) {
    body.images = images;
  }
  if (webSearch === true) {
    body.webSearch = true;
  }
  await postSse("/v1/turns", body, onEvent, signal);
}
```

`WebSearchToggle.tsx`：disabled + `value: boolean` + `onChange`。按钮文案「联网」，`aria-pressed={value}`，class 为 `value ? "composer-tool-btn composer-tool-btn--active" : "composer-tool-btn"`。

`App.tsx`：`const [webSearch, setWebSearch] = useState(false);` **不要**在 send 成功后清掉。`postTurn(sid.current, text, handleEvent, undefined, images, webSearch || undefined)`。Composer 里放在 `AttachmentInput` 与 `OutputFormatInput` 之间。

`toolDisplay.ts` titles 加 `web_search: "Web"`。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm exec vitest run apps/desktop/tests/App.test.tsx apps/desktop/tests/toolDisplay.test.ts packages/web-search/tests packages/loop/tests/run-turn.test.ts apps/host/tests/turn-body.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**（用户未要求则跳过）

```bash
git add apps/desktop/src/WebSearchToggle.tsx apps/desktop/src/api.ts apps/desktop/src/App.tsx apps/desktop/src/toolDisplay.ts apps/desktop/tests
git commit -m "feat(desktop): add sticky web search composer toggle"
```

---

## 手工验收

1. `pnpm desktop:app:restart`（或 `desktop:restart`）。
2. 工作区 `.env` 配 `FLINTLOOM_SEARXNG_URL` 或任一 Key，重启 host。
3. 关「联网」问时事 → 不应出现 Web 工具行。
4. 开「联网」再问 → 可出现 `Web` 工具行和标题/URL/摘要。
5. 未配后端时开联网并迫使模型调用（或看 tool result）→ `failed: search not configured`。

## Spec 覆盖

| Spec | Task |
|---|---|
| 粘性开关、不写进用户气泡 | 5 |
| schema 过滤 + execute 拒绝 + turn/start 续跑 | 3 |
| 四 provider + 假 fetch | 1 |
| 工具契约 / 截断 / disabled | 2 |
| parseTurnBody / overlay / yml / host 不 import 包 | 4 |
| toolDisplay Web | 5 |
| 不做 web_fetch / 其它通道默认关 | 无代码（不实现即满足） |
