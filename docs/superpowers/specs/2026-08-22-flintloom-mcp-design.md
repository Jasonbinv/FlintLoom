# FlintLoom MCP 切片设计

日期：2026-08-22  
状态：已审阅  
产品：FlintLoom — A real agent. / 真正的 Agent。  
范围：总 spec 第 6 刀：**stdio MCP + tools**。一行一个 server，工具名 `mcp__<id>__<name>`。不改 `runTurn`，不加 HTTP，不加桌面页。默认 `flintloom.yml` / `ASSEMBLY` **不**挂 MCP 行。

## 1. 这是什么

用户在工作区 `flintloom.yml` 加一行 `{ id, name: "@flintloom/mcp", config }`。开机 spawn 该 stdio 子进程，`initialize` + `tools/list` 后把工具登记到 `ctx.tools`。模型调用走 `tools/call`，结果进现有 `tool/result`。

验收：临时假 stdio server（`node` 脚本，不打网）挂上后 schema 含 `mcp__fake__echo`，`execute` 回显；缺声明 env 或 initialize 超时则拒绝启动；host `src` 不出现 `@flintloom/mcp`。`flint` 假 chat 一轮仍绿。自动化测试不依赖真实 API key、不启动真实 MCP 云服务。

## 2. 收紧的决策

| 点 | 决定 |
|---|---|
| 传输 / 面 | 只 stdio + tools。不做 resources / prompts / HTTP/SSE。 |
| 组装 | 一行一个 server。`id` 即 server 名。同一 `@flintloom/mcp` 可出现多行。 |
| `id` 注入 | `applyConfig` 合并 `{ ...row.config, ...runtime[row.id], id: row.id }`。`id` 永远等于组装行。 |
| `apply` | 可返回 `void \| Promise<void>`。`ctx.plugin`：同步仍返回 `Disposer`；异步返回 `Promise<Disposer>`，失败回滚本插件 effect。`applyConfig` 一律 `await Promise.resolve(ctx.plugin(...))`。 |
| 默认 yml | 根 `flintloom.yml` 与 `ASSEMBLY` **不加** MCP 行。包仍进根 `devDependencies`，供 `import(name)` 解析。 |
| `cwd` | 子进程 `cwd` = 合并后的 `workspaceRoot`（必须是非空 string）。`createRuntime` 对 `row.name === "@flintloom/mcp"` 的行 **合并** overlay `{ workspaceRoot }`（不覆盖已有的 `envValues`）。缺则拒绝启动。 |
| `env` 名 | `config.env` 为 `string[]`（可空）。不是数组 → 拒绝启动。 |
| `env` 值 | 每个名字：`envValues[name] ?? process.env[name]`。`envValues` 只来自 overlay。缺任一声明名 → 拒绝启动，消息含 **名字**、不含值。 |
| 子进程环境 | 基线（有则拷贝）：`PATH`、`PATHEXT`、`SYSTEMROOT`、`COMSPEC`、`HOME`、`USERPROFILE`、`TMP`、`TEMP`。再加上声明名。任何 `FLINTLOOM_*` **永不**传入。 |
| `.env` | 本片 **不**把工作区 `.env` 自动填进 `envValues`。 |
| 协议 | 自写 JSON-RPC 2.0 + `Content-Length` 头。不引入 `@modelcontextprotocol/sdk`。 |
| 开机 | `initialize`（`protocolVersion: "2024-11-05"`）→ 通知 `notifications/initialized` → `tools/list`。整段超时 **8s**。 |
| 调用 | `tools/call`；尊重 `exec.signal`；另有 **30s** 上限。 |
| 工具名 | `id` 必须 `isPluginId`。MCP 名必须 `/^[a-zA-Z0-9_-]+$/`，否则跳过该条。登记名 `mcp__<id>__<tool>`。 |
| `parameters` | MCP `inputSchema` 原样；缺则 `{ type: "object", properties: {} }`。 |
| 结果 | 只拼 `content[]` 里 `type === "text"` 的 `text`。总长 > 200_000 则截断并追加 `\n\n[truncated]`。非 text 忽略。 |
| `path` 闸门 | 现网 `ToolRegistry` 仍对 string `args.path` 做 `resolveInside`。越界到不了子进程。 |
| 失败文案 | 启动失败消息含 `id` / `command` / `env` / 缺的 env **名**。调用失败 `failed: mcp` 或 `aborted`。不得含密钥、token、env **值**、绝对 `homeDir`。 |
| stderr | 丢弃，不进 session。 |
| 测试 server | `process.execPath` + 仓内夹具脚本。不要 `npx`、不要网络。 |

## 3. 非目标

- HTTP、桌面 MCP 页、插件列表、模型页
- resources、prompts、sampling、根目录 MCP 市场
- `@modelcontextprotocol/sdk`、真实 GitHub/Slack server
- 把工作区 `.env` 自动 overlay 进 MCP
- `channels.send`、guard `ask`、A2UI table/chart
- 改 `runTurn`、往 `createRuntime` 里 `register` 工具
- 引入 / vendor Cordis、dataagent-v3、deepseek-harness

## 4. 架构

```text
flintloom.yml（工作区自加，默认组装没有）
  - id: fake
    name: "@flintloom/mcp"
    config:
      command: <node>
      args: [<fixture>]
      env: [FAKE_TOKEN]

createRuntime
  对 name === "@flintloom/mcp" 的行
    overlay 合并 { workspaceRoot }（保留已有 envValues）

applyConfig
  merged = { ...row.config, ...overlay, id: row.id }
  await Promise.resolve(ctx.plugin(plugin, merged))

@flintloom/mcp apply(ctx, config)  // async
  require("tools")
  校验 id / command / workspaceRoot / env[]
  解析 env 值；缺则 throw
  spawn({ cwd: workspaceRoot, env: 基线 ∪ 声明 })
  initialize + listTools（8s）
  register 每个合法工具
  effect: kill + 卸工具
```

host **不** `import @flintloom/mcp`。扫描 `apps/host/src` 不得出现 `@flintloom/mcp`、`createMcp`、`mcp__`。

## 5. 组件

### 5.1 kernel

`FlintPlugin.apply(ctx, config): void | Promise<void>`。

`Context.plugin`：调用 `apply`；若返回 thenable，则返回的 Promise 在 settle 后交出 `Disposer`，reject 时回滚本插件在 `apply` 期间登记的 effect（与同步 throw 相同）。同步路径行为与现网一致。

`applyConfig`：`stops.push(await Promise.resolve(ctx.plugin(plugin, merged)))`。`merged.id` 在 spread 之后写入，覆盖 yml/overlay 里的 `id`。

现有「按行 apply 并合并 runtime config」测试的期望改为含 `id: "a"`。

### 5.2 stdio 客户端

夹具与实现共用同一套成帧：

```text
Content-Length: <utf8 字节数>\r\n
\r\n
<json>
```

只实现：请求 `initialize`、`tools/list`、`tools/call`；通知 `notifications/initialized`。其它 method 本片不发。

### 5.3 `apply` 配置

| 字段 | 规则 |
|---|---|
| `id` | `isPluginId`，否则 `throw new Error("id")` |
| `command` | 非空 string，否则 `throw new Error("command")` |
| `args` | 缺省 `[]`；若出现则必须是 string[] |
| `env` | 缺省 `[]`；若出现则必须是 string[]（元素 trim 后非空、且不是 `FLINTLOOM_*`） |
| `envValues` | 可选 `Record<string, string>` |
| `workspaceRoot` | 非空 string，否则 `throw new Error("workspaceRoot")` |

`FLINTLOOM_*` 出现在 `env` 列表 → `throw new Error("env")`（防止把 host 密钥声明进子进程）。

### 5.4 工具 `execute`

把模型给的 `args` 作为 MCP `arguments` 原样送出（闸门已先跑）。成功返回拼接文本。RPC error / 超时 / 非 0 退出 → `failed: mcp`。`exec.signal.aborted` → `aborted`。

不 `provide("mcp")`。

## 6. 错误处理

| 情况 | 行为 |
|---|---|
| 默认组装无 MCP 行 | 启动成功；schema 无 `mcp__` |
| yml 有 MCP、无 `tools` | `require("tools")` 拒绝启动 |
| 缺 command / 坏 id / 坏 env / 缺 workspaceRoot / 缺声明 env | 拒绝启动；不留下孤儿进程 |
| initialize / list 失败或 8s 超时 | 拒绝启动；杀掉已 spawn 进程 |
| 某 MCP 工具名非法 | 跳过该条，其它照登记 |
| `tools/call` 失败 | `failed: mcp`；turn 继续 |
| dispose / `stop()` | 杀子进程（含已在飞的 call） |

## 7. 测试

不打网。夹具脚本只读 stdin 帧、写 stdout 帧。

1. `applyConfig` 注入 `id`；异步 `apply` 成功后工具已登记；异步 `apply` 失败回滚。  
2. 假 server：schema 含 `mcp__fake__echo`；`execute({ text: "hi" })` 回显；返回不含 env 值。  
3. 缺声明 env、initialize 超时、坏 command → `createRuntime` / `apply` 拒绝；无残留 node 夹具进程。  
4. 非法 MCP 工具名不进 schema。  
5. `apps/host/src` 扫描无 `@flintloom/mcp`。  
6. 默认 `ASSEMBLY` 不含 `@flintloom/mcp`。  
7. `pnpm test` 与 `pnpm typecheck` 全绿。

## 8. 总 spec 对接

- 第 5 节 `packages/mcp`、第 12 节「子进程只用配置行声明的环境变量」：本片按 **基线 ∪ 声明名、永不传 `FLINTLOOM_*`** 落地。  
- 「模型看见即记录」：MCP 结果走 `tool/result`。  
- 第 16 节：第 6 刀为本片。桌面插件/模型页、A2UI table/chart、guard `ask` 仍后续。
