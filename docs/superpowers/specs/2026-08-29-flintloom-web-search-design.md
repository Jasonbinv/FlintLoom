# FlintLoom 联网搜索设计

日期：2026-08-29  
状态：已复核  
产品：FlintLoom — A real agent. / 真正的 Agent。  
范围：Composer「联网」开关 + 工具 `web_search` + 可切换后端（SearXNG / Tavily / Brave / 博查）。从出生就是插件 `@flintloom/web-search`：禁止 `createRuntime` 里直接 `register` 该工具。

## 1. 这是什么

工作台输入框旁增加**粘性**「联网」开关。关掉时，本轮（含该轮后续 step / guard 续跑）模型看不到、也不能调用 `web_search`。打开时，agent **按需**决定是否搜索，不强制每轮都搜。

搜索走统一工具契约，后端可配：自建 SearXNG（零费用）或 Tavily / Brave / 博查 API Key。结果仍是现有 `tool/call` + `tool/result`，不新增 SSE 事件类型。

验收：`pnpm desktop` 打开 demo 工作区，关联网发「今天天气」→ schema 无 `web_search`、无外网请求。开联网且配好 SearXNG 或任一 Key → 模型可调用 `web_search`，`tool/result` 含标题、URL、摘要。未配置后端时工具返回 `failed: search not configured`（与现有 `failed:` 前缀一致），不抛崩 loop。自动化测试注入假 `fetch`，不打真实搜索引擎。

## 2. 收紧的决策

| 点 | 决定 |
|---|---|
| 开关语义 | 关 = 本轮工具列表剔除 `web_search`，execute 若仍被调则 `failed: web_search disabled`。开 = 交给模型决定。 |
| 粘性 | 开/关跟会话 UI 走，跨多轮保持，直到用户再点。发完消息**不**自动关掉（与「输出」一次性 chip 不同）。 |
| 用户气泡 | **不**把「请使用 web_search」写进用户可见消息。开联网时仅在该轮 system 侧追加一句英文短提示。 |
| 其它通道 | CLI / webhook / 飞书等 **默认关**。本片不给它们加开关。 |
| 插件 | `@flintloom/web-search`，yml id `web-search`，依赖 `tools`，在 `loop` 之前。去掉该行 → 无工具、无开关也可发消息。 |
| 注册时机 | 插件在 yml 里就 **始终** `register(web_search)`。是否出现在模型 schema 由 **该轮** `webSearch` 标志过滤，不随开关 unregister（避免并发 turn 互相踩）。 |
| 续跑 | `webSearch` 写在 `turn/start` 上（可选布尔，缺省 = false）。`continueTurn` / `continueGuardTurn` 读同一 turn 的该字段。 |
| 后端 | `searxng` \| `tavily` \| `brave` \| `bocha`。显式 `FLINTLOOM_SEARCH_PROVIDER` 优先；未写则按 searxng URL → tavily → brave → bocha 选第一个已配置的。 |
| 配置来源 | 与模型 Key 相同分层：`process.env` 覆盖工作区 `.env`。host `createRuntime` 把解析结果放进 `runtimeConfigById["web-search"]`。 |
| `web_fetch` | **本片不做**。只返回搜索命中的 title / url / snippet。 |
| Guard | `web_search` 不走 guard-ask。 |
| 配额 / 计费 UI | 不做。超限以后端错误字符串为准。 |
| 爬搜索页 | 禁止。只走各后端官方/JSON API。 |

## 3. 非目标

- 读网页正文、RAG、引用角标、搜索历史页
- 公共 SearXNG 实例、Google HTML 抓取、DuckDuckGo 非官方包
- 设置页里的 Provider 向导、额度仪表盘
- 图片/新闻/学术专用搜索类型（可用 query 表达，不单开工具）
- 改默认 system 人格长文；只在开联网的 turn 追加一句短提示

## 4. 架构

```text
Composer「联网」 ──► POST /v1/turns { webSearch: true }
                              │
                              ▼
                         runTurn
                   tools.schemas() 过滤
                   system += search hint
                              │
                              ▼
                        web_search 工具
                              │
              ┌─────────┬─────┴──────┬──────────┐
              ▼         ▼            ▼          ▼
           SearXNG    Tavily       Brave      博查
```

yml 在 `shell` 之后、`knowledge` 之前插入：

```yaml
  - id: web-search
    name: "@flintloom/web-search"
```

根 `package.json` 把 `@flintloom/web-search` 列入 `devDependencies`（与 fs/grep 一样，供 `import(name)` 解析）。host `src` **不** `import "@flintloom/web-search"`。

## 5. 组件

### 5.1 桌面开关

- 放在 Composer 工具条，「附件」与「输出」之间，按钮文案「联网」。
- 打开时 `composer-tool-btn--active`。无下拉。
- `postTurn(sessionId, text, onEvent, signal?, images?, webSearch?)`：仅当 `webSearch === true` 时把 `webSearch: true` 写入 JSON；false / 缺省不传该字段。不改 signal/images 参数顺序。
- 未挂 `web-search` 插件时：按钮仍可点，打开后 agent 没有该工具。v1 **不**根据 `/v1/plugins` 禁用按钮，不加新 HTTP。

### 5.2 Turn 管道

`TurnBody` / `parseTurnBody`：可选 `webSearch`，必须是 boolean；其它类型 → 400。

`RunTurnInput.webSearch?: boolean`

`SessionEvent`：

```ts
{ type: "turn/start"; turnId: string; startedAt: number; webSearch?: boolean }
```

旧事件无该字段 = false。

`RunStepsInput` 带 `webSearch: boolean`（`runTurn` 用入参；`continueTurn` / `continueGuardTurn` 用 `turnWebSearch(session, turnId)` 从该轮 `turn/start` 读取，缺省 false）。

`runSteps` 调模型时：

```ts
const schemas = tools.schemas().filter(
  (s) => input.webSearch === true || s.name !== "web_search",
);
```

`executeToolCall` 与 `continueGuardTurn` 的 `tools.execute` 都传入 `webSearch: input.webSearch`。

开联网时 system 消息为 `conversationSystemMessage(true)`：

```text
You are FlintLoom, a real agent. Use tools to work in the workspace.
You may call web_search when you need current or external information. Do not search for questions you can answer from the workspace or your knowledge.
```

关联网时保持现有一句 system，不提搜索。

`tools.execute("web_search", ...)`：若该 turn `webSearch !== true`，返回 `failed: web_search disabled`（防 schema 过滤被绕过）。把 `webSearch` 放入 `ToolExec`。

### 5.3 工具契约

```text
name: web_search
description: Search the public web. Use for current events, docs, or facts not in the workspace.
parameters:
  type: object
  required: ["query"]
  properties:
    query: { type: "string", minLength: 1, maxLength: 200 }
    count: { type: "integer", minimum: 1, maximum: 8 }
```

`count` 缺省 5。query 去首尾空白后为空 → `failed: empty query`。

成功 `tool/result` 文本（给模型，不是 JSON 代码块）：

```text
1. <title>
   <url>
   <snippet>
2. ...
```

零命中：`No results.` 超时：`failed: timeout`。`signal.aborted`：`aborted`。HTTP 4xx/5xx：`failed: search <status>`。未配置后端：`failed: search not configured`。

单条 snippet 最长 240 字，总结果最长 8_000 字，超出截断。

超时 12s，尊重 `exec.signal`。

含 CJK 的 query：SearXNG `language=zh-CN`；博查按其中文 API；Tavily/Brave 传 query 原文，不另翻。

### 5.4 Provider

`searchWeb(config, args, signal)` 返回 `{ ok: true, hits }` 或 `{ ok: false, error }`（error 已是 `failed: …` / `aborted`）。`config.fetch` 可注入，缺省 `globalThis.fetch`。测试只打这一层 + 假 fetch，不启真实 SearXNG。

含 CJK：`/[\u3400-\u9fff]/`.test(query)。

| id | 配置 | 调用 |
|---|---|---|
| `searxng` | `FLINTLOOM_SEARXNG_URL`（去尾 `/`） | `GET {url}/search?q=&format=json&language=`（CJK → `zh-CN`，否则省略 language） |
| `tavily` | `FLINTLOOM_TAVILY_API_KEY` | `POST https://api.tavily.com/search` JSON `{ query, max_results, search_depth: "basic" }`，Header 不用 Bearer；key 在 JSON `api_key` |
| `brave` | `FLINTLOOM_BRAVE_API_KEY` | `GET https://api.search.brave.com/res/v1/web/search?q=&count=` Header `X-Subscription-Token` |
| `bocha` | `FLINTLOOM_BOCHA_API_KEY` | `POST https://api.bochaai.com/v1/web-search` Header `Authorization: Bearer`，JSON `{ query, count, summary: true }`；命中取 `data.webPages.value[]` 的 `name`/`url`/`snippet` |

显式 provider 已选但对应凭证缺失 → `failed: search not configured`，不静默落到另一家。

未设 provider：按 searxng → tavily → brave → bocha 选第一个凭证齐全的。全都没有 → 同上错误。

密钥不得出现在 `tool/result`、session 事件、日志。

### 5.5 工作区 env 示例

只改 `FlintLoom/.env.example`（host 读的是当前工作区 `.env`，demo 没有独立 example）。增加注释块（不写真实 Key）：

```bash
# FLINTLOOM_SEARCH_PROVIDER=searxng
# FLINTLOOM_SEARXNG_URL=http://127.0.0.1:8080
# FLINTLOOM_TAVILY_API_KEY=
# FLINTLOOM_BRAVE_API_KEY=
# FLINTLOOM_BOCHA_API_KEY=
```

`docs/服务重启指南.md` 不强制改；SearXNG 怎么起另开文档段落可放到本 spec 实现后的 README 一句：本机 `docker run` 映射 8080，不提交 compose 也可。

## 6. 数据流

1. 用户打开「联网」，发消息。
2. 桌面 `POST /v1/turns` `{ sessionId, text, webSearch: true }`。
3. host 解析 body → `loop.runTurn({ webSearch: true })`。
4. `turn/start` 带 `webSearch: true`。
5. 该轮 schema 含 `web_search`；模型可调用 0 次或多次（仍受 `MAX_STEPS`）。
6. 插件按 config 请求后端，格式化 hits。
7. 用户关掉开关后再发：`webSearch` 缺省/false，schema 无该工具。

A2UI / guard 续跑：从该 `turnId` 的 `turn/start.webSearch` 恢复，不读 Composer 当前状态。

## 7. 错误处理

| 情况 | 行为 |
|---|---|
| 插件未装 | 开关可点；模型无工具；不报主机错误 |
| 开联网但无后端 | 有工具；调用后 `failed: search not configured` |
| 关联网却调用 | `failed: web_search disabled` |
| 超时 / 中止 | `failed: timeout` / 尊重 abort |
| 后端 JSON 非预期 | `failed: search`，不把原始 body 回给模型 |

不因搜索失败把整轮标成 host 500。

## 8. 测试

- `packages/web-search/tests/providers.test.ts`：假 HTTP，四家 provider 映射 title/url/snippet；缺配置；显式 provider 缺凭证。
- `packages/web-search/tests/tool.test.ts`：`webSearch` false 时 execute 拒绝；query 空；截断。
- `packages/loop/tests/run-turn.test.ts`：`webSearch` false 时 chat 收到的 tools 不含 `web_search`；true 时含；`turn/start` 带字段；continue 保持。
- `apps/host/tests`：`parseTurnBody` 接受 `webSearch: true`，拒绝 `"yes"`；`server.test.ts` 的 host src 扫描加上 `@flintloom/web-search`；省略 yml 行则 schema 无 `web_search`。
- `apps/desktop/tests`：开关打开后 `/v1/turns` body 含 `webSearch: true`；关闭时不含该字段；默认关闭。`toolDisplay` 测 `web_search` 标题为 `Web`、summary 用 `query`。
- host `ASSEMBLY` 与根 `flintloom.yml` 加上 `web-search` 行。
- 禁止测试访问公网。

## 9. 实现顺序

1. Provider 纯函数 + 假 HTTP 测试  
2. 工具 + 插件 + yml  
3. `ToolExec.webSearch`、`runTurn` 过滤、`turn/start`  
4. host `parseTurnBody` + `runtimeConfigById`  
5. 桌面开关  
6. `.env.example`

## 10. 风险

- Brave 需绑卡；`.env.example` 注明控制台设花费上限。  
- 博查字段按上表锁定；测试用假 fetch，不断网校验生产站。  
- 中文质量：默认鼓励 SearXNG + 博查；不在 v1 做引擎混排。  
- 工作台 `toolDisplayTitle("web_search")` = `Web`（`grep` 已占用 `Search`）。
