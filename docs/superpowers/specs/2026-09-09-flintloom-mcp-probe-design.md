# FlintLoom MCP 连通性测试按钮

日期：2026-09-09  
状态：已复核（二次：超时、草稿 env、与运行时关系）  
产品：FlintLoom — A real agent. / 真正的 Agent。  
范围：插件页每台 MCP 增加「测试」：另起进程做 `initialize` + `tools/list`，不调用工具、不写 YAML、不改已加载运行时。

## 1. 这是什么

「已加载」只表示上次 host 启动/重载时握手成功。用户改 command/args 或怀疑进程挂掉时，没有不进对话、不重载整机的再测入口。

验收：

- 仓内假 MCP（`process.execPath` + `packages/mcp/fixtures/fake-mcp-server.mjs`）点「测试」→ 卡片「测试通过」，工具列表含 `mcp__fake__echo`。
- 把 command 改成不存在的可执行文件（未保存也可）→ 「测试失败」+ 短错误（`mcp` 或 `timeout`），YAML 未改，GET 状态表仍是测之前的值。
- 已关闭的 server：按钮禁用；若仍 POST → 400 `enabled`。
- 对话进行中也可以测，不返回 409 busy。
- `apps/host/src` 仍不得出现 `@flintloom/mcp`、`createMcp`、`mcp__`。

自动化测试不打网、不跑 `npx`/`uvx`。

## 2. 已定决策

| 点 | 决定 |
|---|---|
| 测什么 | 连通性：spawn → `initialize`（含 `tools/list`）→ kill。不 `tools/call`。 |
| 进程 | 与运行时已有子进程独立。测完必 kill。不登记 `ToolRegistry`。 |
| 配置来源 | 请求带非空 `command`：用 body 的 command/args/env（测未保存草稿）。否则用合并后的 `mcp-servers.yml` 声明（工作区覆盖个人）。 |
| env 值 | 与开机相同：声明名从工作区 `.env` overlay 进 `envValues`，再 `buildChildEnv`；缺名 → `missing env: NAME`。 |
| 超时 | **仅 probe**：`initialize` 整段 **30s**（与 `MCP_CALL_TIMEOUT_MS` 相同量级）。开机/重载仍是 **8s**，本片不改。npx/uvx 冷启动常超过 8s，按钮若沿用 8s 会误报失败。 |
| 错误 | 复用 `publicMcpError` 那套短词：`timeout` / `mcp` / `command` / `missing env: …`。不含密钥、env 值、绝对 `homeDir`。 |
| 工具名 | 合法 MCP 名才列出，格式 `mcp__<id>__<name>`（与登记规则相同，非法名跳过）。 |
| 按钮 | 每张 MCP 卡片（含个人只读）。文案 **测试**。关闭、保存中、本行测试进行中时禁用。 |
| 结果展示 | 该卡片内一行提示，不弹窗。成功：`测试通过` + 工具名（无则不加）+ 固定后缀「；对话仍用上次重载的进程」。失败：`测试失败：` + error。不改绿色「已加载」徽章。 |
| HTTP | `POST /v1/mcp-servers/:id/test`。鉴权与其它 mcp-servers 路由相同。 |
| busy | 不挡测试。不写 YAML，不 `reloadRuntime`。 |
| host 隔离 | 握手在 `@flintloom/mcp`；kernel 用 `WORKSPACE_ROOT_OVERLAY_PACKAGES[0]` + `importFn` 调用；host 只调 kernel。 |

## 3. 非目标

- 调用 echo/fetch 等真实工具、抓网页
- 测完自动重载 host 或改启用开关
- HTTP/SSE MCP
- `flintloom.yml` 手写 MCP 行（插件页 MCP 块不管理它们）
- 改成帧、改 `runTurn`、图表库
- 为本片给 `spawn` 加 `shell: true`（Windows 直接 `npx.cmd` 仍可能 `mcp`；继续用现有 `cmd.exe /c npx` 写法）

## 4. 架构

```text
PluginsPane 「测试」
  POST /v1/mcp-servers/:id/test
    body?: { command, args?, env? }

host mcp-servers-http
  → kernel probeMcpServer(...)
       import(WORKSPACE_ROOT_OVERLAY_PACKAGES[0])
       → mcp.probeMcpServer({ id, command, args, env, envValues, workspaceRoot })
            McpStdioClient.initialize()
            listTools → 前缀后返回
            finally kill
```

`probeMcpServer`（mcp 包导出）输入与 `validateMcpConfig` 相同形状，另接受 `timeoutMs`（probe 传 30_000）。`McpStdioClient.initialize` 增加可选超时，默认仍 8s，避免开机行为变化。成功 `{ ok: true, tools: string[] }`；失败 `{ ok: false, error: string }`。不 throw 给 HTTP 层当 500（校验类仍可由 kernel 映射为 400）。

`publicMcpError` 抽到 `packages/mcp/src/errors.ts`（或同等模块），`apply` 与 `probe` 共用。kernel 读工作区 `.env` 必须复用现有 `resolveMcpEnvValues` 逻辑，禁止另写一套。

## 5. HTTP

路径：`POST /v1/mcp-servers/:id/test`（须在 `PUT /v1/mcp-servers/:id` 之前匹配）。

`:id` 必须是合并声明里已有的 id（`listMcpServerDeclarations`）。没有 → 400 `id`。  
该声明 `enabled === false` → 400 `enabled`（即使 body 带 command）。

Body：

- 缺省、`{}`、或没有 `command` 键：用声明的 command/args/env。
- `command` 为非空 string：用它；`args`/`env` 缺省 `[]`；类型不对 → 400 `args` / `env`。
- `command` 为空 string → 400 `command`。

成功 200：

```json
{ "ok": true, "tools": ["mcp__fake__echo"] }
```

握手失败 200：

```json
{ "ok": false, "error": "timeout" }
```

（失败也是 200，避免桌面把业务失败当 host unreachable。400 只用于 id/command/args/env/enabled。）

未授权与现网其它 `/v1/mcp-servers` 一样 401。

## 6. 桌面

`testMcpServer(id, draft?)` 调上述 POST。解析 **HTTP 200 + `{ ok: false }` 为测试失败**，不要走现有 `throwIfMcpMutationFailed`（它会把非 2xx 当操作失败，且无法表达 ok:false）。400 映射：`enabled` → 「请先启用」，其余与保存相同（`mcpWriteError` 增补 `enabled`）。

可写卡片：body 带当前表单。`args` 与保存相同（JSON 数组字符串，`parseArgs`）；`env` 与保存相同（逗号/空白分隔的名字，`parseEnv`），**不是** JSON 数组。解析失败不发请求，提示「args 无效」/「env 无效」。  
只读卡片：不带 body。

测试进行中该行按钮显示「测试中…」，其它卡片仍可点。

不把测试结果写进 GET 的 `status` / `tools`（避免和运行时两套真相）。展开「工具与详情」仍只显示运行时已登记工具。

## 7. 测试

包测试（`packages/mcp`）：`probeMcpServer` 对夹具成功含 `mcp__fake__echo`；坏 command 失败且不抛；`finally` 后无残留夹具进程（与现有 plugin 测试同级：测完 `initialize` 的 client 已 kill）。

Kernel：声明 id 不存在则返回/抛给 host 映射的 `id`；disabled 映射 `enabled`。可用 `importFn` 注入假 probe，不强制 kernel 测试真 spawn。

Host：夹具写入工作区 `mcp-servers.yml` 后 POST test → 200 `ok: true` 且 tools 含 echo；坏 command body 覆盖 → `ok: false`；yml 文件内容未变。`apps/host/src` 扫描仍无 `@flintloom/mcp` 与 `mcp__`。

桌面：`PluginsPane` 有 `测试`；点击后 mock fetch 到 `/test` 成功则出现「测试通过」。

## 8. 文件

```text
packages/mcp/src/errors.ts         # publicMcpError，apply 与 probe 共用
packages/mcp/src/probe.ts
packages/mcp/src/client.ts         # initialize 可选 timeoutMs，默认 8s
packages/mcp/src/index.ts
packages/mcp/tests/probe.test.ts
packages/kernel/src/mcp-probe.ts
packages/kernel/src/mcp-servers.ts # 若抽出 resolveMcpEnvValues 供 probe 用
packages/kernel/src/index.ts
packages/kernel/tests/mcp-probe.test.ts
apps/host/src/mcp-servers-http.ts
apps/host/tests/server.test.ts
apps/desktop/src/api.ts            # 单独解析 200 + ok
apps/desktop/src/PluginsPane.tsx
apps/desktop/tests/App.test.tsx    # 或 PluginsPane 现有测法
docs/mcp-servers.md
```

不改 `ReasoningRow` / Chat。不改 `frame.ts`。

## 9. 错误与空态

| 情况 | 行为 |
|---|---|
| 声明不存在 | 400 `id` |
| 已关闭 | 按钮禁用；POST 400 `enabled` |
| 缺 env 名 | 200 `{ ok: false, error: "missing env: NAME" }` |
| initialize 超时 / spawn EINVAL | 200 `{ ok: false, error: "timeout" 或 "mcp" }` |
| 成功但无合法工具名 | 200 `{ ok: true, tools: [] }`，文案「测试通过；对话仍用上次重载的进程」 |
| 直接 `npx.cmd`（无 cmd.exe） | 与开机相同，可能 `{ ok: false, error: "mcp" }` |
| 对话占用 | 照测，不 409 |
| 个人只读 | 可用 YAML 配置测 |

无 TBD。
