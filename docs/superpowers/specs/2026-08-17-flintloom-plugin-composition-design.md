# FlintLoom 插件组装（1.5 刀）设计

日期：2026-08-17  
状态：待审阅  
产品：FlintLoom — A real agent. / 真正的 Agent。  
范围：总 spec 的 **插件组装刀**。采用 deepseek-harness「一切皆插件」原则的轻量子集：yml 真正加载、可逆 `apply`、loop 也是插件、一条 `tools/pre-execute` waterfall。不 vendor Cordis，不引入 deepseek-harness 包。

## 1. 这是什么

开机从 `flintloom.yml` 挂载 Loom 插件，而不是在 `createRuntime` 里手工 `import` + `register`。工具、模型 provider、session store、loop 都通过 `apply(ctx)` 登记；卸载时 `effect` 一并撤销。

对话语义不变：同一套 `runTurn`、同一套 session log、kind 缺了就失败、工作区闸门仍在 guard 之前。

验收：`flint` 仍能跑完一轮编程对话；yml 去掉 `fs` 后 schema 里没有它；坏 yml / 坏插件名拒绝启动。自动化测试不依赖真实 API key。

## 2. 非目标

- `flint plugin add`、MCP、skill、通道、知识库、A2UI、信息图
- `tools/post-execute`、`agent/pre-step`、inject 调度器、isolate、HMR、profile 叠层
- 改 `fs` / `grep` / `shell` / DocForge 解析的工具行为
- 改预览 HTTP、改桌面 UI
- 把 HTTP 路由做成插件
- Vendor Cordis 或依赖 `@deepseek-ai/*`

## 3. 架构

```text
flintloom.yml
    → kernel boot：按行 import name → ctx.plugin(apply)
    → host / CLI 只 ctx.require("loop").runTurn(...)

服务插件（先）          能力插件（后）
models  → ctx.models    models-chat → registerChat
tools   → ctx.tools     fs/grep/shell/docforge → register tools
session → ctx.sessions  loop → ctx.loop.runTurn
```

Flint（host）继续拥有：HTTP、token、工作区路径、把凭证填进 `models-chat` 的 runtime config。  
Loom 拥有：注册表、工具、loop。桌面仍只连 `127.0.0.1`，不是插件。

### 3.1 插件契约

每个 Loom 功能包 **default export**：

```ts
{
  name: string;
  apply(ctx: Context): void;
}
```

`import(name)` 之后：若 `mod.default` 有 `apply` 则用它；否则若模块自身有 `apply` 则用模块。两者都没有 → 拒绝启动，消息含该行 `id` 与 `name`。

工厂函数（`createFsTool` 等）保留给单测。开机路径只走 `apply`。

### 3.2 Kernel 新增

在现有 `provide` / `get` / `plugin` 之外：

| API | 行为 |
|---|---|
| `ctx.require<T>(key)` | 没有该键则抛错，消息含键名 |
| `ctx.effect(dispose)` | 把 disposer 记入当前插件；`plugin()` 返回的 stop 会按反序调用 |
| `ctx.hook(event, handler)` | 登记 waterfall 监听；返回的 disposer 已 `effect` |
| `ctx.waterfall(event, payload, terminal)` | around-middleware：按登记顺序包住 `terminal`；监听器必须 `next()` 才能继续；不调用 `next()` 则短路，其返回值作为 waterfall 结果 |

`plugin(p)` 的语义不变：`apply` 期间发生的 `provide` / `effect` / `hook` 都归该插件；`stop()` 只撤销它自己的。

kernel 导出 `applyConfig(ctx, config, importFn?)`：按行动态 import（默认 `import(name)`）、`ctx.plugin`；返回一个总 `stop` 撤销全部已挂行。中途失败则先 stop 已成功的行再抛错。`waterfall` **await** 每个监听器和 `terminal`（`guard.gate` 与工具 `execute` 都是 async）。

没有 inject 调度器。yml **从上到下就是依赖顺序**。后挂的插件 `require` 不到先挂的服务 → 拒绝启动。

### 3.3 服务键

| 键 | 谁 provide | 形状 |
|---|---|---|
| `models` | `@flintloom/models` | 现有 `ModelRegistry` |
| `tools` | `@flintloom/tools` | 现有 `ToolRegistry`（构造时拿到 `ctx`，以便 `execute` 调 waterfall） |
| `sessions` | `@flintloom/session` | `{ get(id): Session \| undefined; getOrCreate(id): Session }` |
| `loop` | `@flintloom/loop` | `{ runTurn(input): Promise<RunTurnResult> }` |

`runTurn` 输入不再含 `models` / `tools`，改为含 `ctx`。函数内 `ctx.require("models")`、`ctx.require("tools")`。系统提示词、最多 8 步、取消、chunk / tool 事件，与现网一致。

### 3.4 默认 yml 顺序

仓库根 `flintloom.yml` 补全为：

```yaml
plugins:
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
```

`id` 必须唯一。`name` 只接受可被 Node 解析的包名（本仓 workspace 包）。这一刀不做相对路径插件。

### 3.5 凭证 overlay

API key **不写进 yml**。host 在 boot 前按现有顺序解析（进程环境变量 → 工作区 `.env` → `~/.flintloom/credentials` 的 `chatApiKey`），按 **id** 合并进该行 `config`：

```ts
config = { ...row.config, ...runtimeConfigById[row.id] }
```

`models-chat` 读 `config.apiKey` / `config.baseUrl` / `config.model`。没有 `apiKey` 则不 `registerChat`（host 仍启动）。密钥不进 session log、不进 SSE、不进 yml 文件。

## 4. `tools/pre-execute`

`ToolRegistry.execute` 固定为：

```text
工具未注册 → 抛错
args.path 为字符串 → resolveInside（确定性闸门，永远先跑，waterfall 不能放宽）
→ ctx.waterfall("tools/pre-execute", payload, () => def.execute(args, exec))
```

payload：`{ tool, args, workspaceRoot, channel, signal }`。

`tools` 的 `apply` 登记**第一条** `pre-execute` 监听：若 `ctx.require("models").resolveGuard()` 有值，则调用 `gate`；`deny` 返回 `guard denied: <name>`，`ask` 返回 `guard denied: <name> (ask not supported in slice 1)`，均不调用 `next()`。无 guard 则 `next()`。

字符串结果与现网完全一致。越界仍抛 `WorkspaceEscapeError`，发生在 waterfall 之前。

这一刀不加 `tools/post-execute`。host SSE 仍用 `runTurn` 的 `onEvent` 回调，不做 session 事件总线。

## 5. Host 与 CLI

`createRuntime(workspaceRoot, homeDir)`：

1. 读 `{workspaceRoot}/flintloom.yml`（缺文件或损坏 → 抛错，消息含 `plugins` 或路径）
2. `loadConfig` → 凭证 overlay → `new Context()` → 按行 `import` + `ctx.plugin`
3. 返回 `{ ctx }`（不再返回独立的 `models` / `tools` / `sessions` 引用；需要时 `ctx.require`）

`apps/host` **禁止** import `@flintloom/fs`、`@flintloom/grep`、`@flintloom/shell`、`@flintloom/models-chat`、以及 DocForge 的 `createDocProbeTool` / `createDocParseTool`。

允许继续 import：`@flintloom/kernel`、`@flintloom/models`（类型与 `snapshot`）、`@flintloom/session`（类型）、`@flintloom/tools` 的 `WorkspaceEscapeError`、DocForge 的 **纯函数** `parse` / `probe` / `detectType`（预览 HTTP 用，不是插件组装）。

`POST /v1/turns`：`sessions.getOrCreate(sessionId)`，然后 `ctx.require("loop").runTurn({ ctx, session, text, workspaceRoot, channel: "host", signal, onEvent })`。

CLI：同一 `createRuntime`；`getOrCreate("cli")`；`channel: "cli"`。不再 `import { runTurn } from "@flintloom/loop"`。

`apply` 抛错或 `require` 失败：拒绝启动，并对已经 `plugin()` 成功的行调用 stop。

## 6. 错误处理

| 失败 | 行为 |
|---|---|
| 工作区没有 / 损坏 `flintloom.yml` | 拒绝启动 |
| 某行 `name` 无法 import、没有 `apply`、`id` 重复 | 拒绝启动，消息含该行 `id` 或 `name` |
| `apply` 抛错或 `require` 缺失 | 拒绝启动，dispose 已挂上的插件 |
| 未配置 `chat` | **允许启动**；turn 写 `model/error` 并 `failed` |
| yml 去掉某工具插件 | 启动成功；schema 无该工具；若模型仍调用 → `Tool not registered` |
| 运行中对该插件 `stop()` | 撤销其 `effect` / `provide` / `hook` |
| turn 内模型 HTTP 错、取消、工具抛错 | 与现网相同 |

总 spec 原「未配置 chat 则拒绝启动」按现网放宽，以本表为准。

## 7. 测试

全部不依赖真实 API key。

1. yml 不含 `fs` → boot 后 `tools.schemas()` 无 `fs`；含 `fs` 则有。
2. 对 fs 插件的 `stop()` 之后，`execute("fs", …)` 失败，schema 无 `fs`。
3. 缺 yml、yml 无 `plugins`、无法 import 的 `name`、重复 `id` → `createRuntime` 抛错。
4. yml 有 `loop` 无 `models` → 启动失败，消息含 `models`。
5. host 源码（不含测试）不出现对 `@flintloom/fs`、`grep`、`shell`、`models-chat` 以及 `createDocProbeTool` / `createDocParseTool` 的 import。
6. CLI / loop：假 chat 一轮「读文件 → 回复」仍绿。
7. 假 guard `deny` 时工具函数调用次数为 0；越界路径在 waterfall 前抛 `WorkspaceEscapeError`。
8. 无 `apiKey` 时 host 能 listen；`POST /v1/turns` 以 `failed` 结束且事件含 `model/error`。

现有 host 测试若使用无 yml 的临时目录，必须写入合法 `flintloom.yml`（可与仓库默认列表相同，或按用例裁剪）。

## 8. 对已有切片的影响

- 工作台、文件预览：**HTTP 与 UI 语义不变**。host 不再手工 register 工具。
- DocForge 解析切片：「只多注册两个工具」改为由 `@flintloom/docforge` 的 `apply` 登记 `doc_probe` / `doc_parse`。解析纯函数不变。
- 第一刀计划里「host 启动时手工 register」作废，以本 spec 为准。

## 9. 实现顺序（本刀内）

每一项结束时现有 `pnpm test` 保持可跑（或该步测试先红后绿）：

1. Kernel：`require`、`effect`、`hook`/`waterfall`、按 config 加载插件（含失败用例）。
2. models / tools / session 包：default `apply`，provide 服务；tools 把 guard 挪到 `pre-execute` 监听。
3. fs / grep / shell / models-chat / docforge / loop：default `apply`。
4. 默认 yml 补全；host/CLI 改为 boot + `ctx.require`；删手工 register。
5. 验收测试全绿。
