# FlintLoom 插件与 MCP 能力管理设计

日期：2026-09-04  
状态：已复核  
产品：FlintLoom — A real agent. / 真正的 Agent。  
范围：工作台「插件」页从只读列表改为可管理：stdio MCP 增删改开关（第一期）；可选能力插件开关（第二期）。写回工作区 YAML 的 `enabled`，保存后原子重载 host。单台 MCP 失败只标红，不拖垮内核。

## 1. 这是什么

市场上的 stdio MCP 与本产品可选能力（天气、知识库、文档等）都要能在前端手动接入或关掉，但用户不必给每把工具做 schema 适配。聊天输入栏「联网」仍是唯一的本轮策略开关；其它开关都在插件页。

验收（第一期）：`pnpm desktop` 打开工作区，在插件页添加仓内假 MCP → 重载后 schema 含 `mcp__<id>__echo`，对话可调用；把 command 改错 → 该行 `status: error`，聊天与其它插件仍可用；关掉该行 → 无对应 `mcp__*` 工具。个人目录 `~/.flintloom/mcp-servers.yml` 的条目只读可见，复制到工作区后可改。

验收（第二期）：关掉 `weather` → schema 无 `get_weather`，对话仍可用；关知识库则文档工具一并没，且 host 不崩；系统提示不再点名已关掉的 `a2ui_emit` / `infographic_render` / `doc_*`。聊天框仍有且仅有「联网」。

自动化测试不打网、不用 `npx`、不依赖真实 API key。MCP 夹具继续用仓内 `packages/mcp/fixtures/fake-mcp-server.mjs`。

## 2. 收紧的决策

| 点 | 决定 |
|---|---|
| 分两期 | 第一期：MCP 管理 + 原子重载 + MCP 故障隔离（含更新 `docs/mcp-servers.md`）。第二期：可选能力开关 + 提示词按工具裁剪 + 知识库/文档绑定。两期各一份实现计划，第一期可单独交付。 |
| 配置落点 | 工作区 YAML。MCP → `mcp-servers.yml`；能力 → `flintloom.yml` 对应行。不写个人 overlay 当主开关。 |
| `enabled` | 缺省 / 省略 = 开。只把 `enabled: false` 写进文件；打开则删除该键，不写 `enabled: true`。 |
| 重载 | 先 `createRuntime` 成功，再 `stop` 旧实例并切换。新实例失败 → 旧实例继续服务。 |
| 忙 | **先写 YAML**，再重载。有进行中的 turn → 新接口 409 JSON `{ "error": "busy", "written": true }`。现有 `POST /v1/settings/reload` 与 `POST /v1/plugins/install` 仍返回纯文本 `busy`（桌面已按 `err.message === "busy"`）。插件页提示对话结束后点「重载 host」。 |
| MCP 失败 | `apply` **不抛**（含 `validateMcpConfig` 失败、缺 env、initialize 超时、进程退出）。该 id `status: error`，不登记工具，杀掉已 spawn 进程。其它插件照常。错误信息只含 `id` / `command` / `args` / `env` / env **名** / `timeout`，不含 token、env 值、`homeDir`。 |
| 修订旧 MCP spec | `2026-08-22-flintloom-mcp-design.md` 里「缺 env / initialize 超时则拒绝启动整机」改为本片的隔离行为。工具名、成帧、8s/30s、`failed: mcp`、host 不 import `@flintloom/mcp` 仍有效。 |
| MCP 传输 | 仍只 stdio + tools。不做 HTTP/SSE、resources、prompts、schema 编辑、按工具勾选。 |
| 初始化超时 | 仍 8s。第一次 `npx` 拉包超时视为该行 `error`，用户改完或点重载再试。本片不延长超时、不做安装进度。 |
| `GET /v1/plugins` | **不改语义**：仍是当前 runtime 已 apply 的行，`status` 只有 `"loaded"`。禁用的 MCP/能力不出现在这里。 |
| MCP 列表 API | 新建 `/v1/mcp-servers`（见 §5）。含禁用项与失败项。 |
| 能力列表 API | 新建 `GET /v1/plugins/declared`：读 `flintloom.yml` 声明（含 `enabled: false`），带 `kind` / `enabled` / `toggleable`，不含 `config`。 |
| 可关能力 | 非内核、非渠道、且不是 `web-search`。预置：`weather`、`knowledge`、`docforge`、`infographic`、`a2ui`、`skill`、`media-tools`。设置页装进来的第三方包同样可关。 |
| 不可关 | 内核：`models`、`tools`、`session`、`models-chat`、`models-media`、`models-guard`、`loop`、`fs`、`grep`、`shell`。渠道：`channel`、`channel-webhook`、`channel-telegram`、`channel-discord`、`channel-slack`、`channel-feishu`、`channel-wecom`、`channel-acp`。`web-search` 只走聊天框「联网」。 |
| 知识库与文档 | 关 `knowledge` 时同一写入把 `docforge` 设为 `enabled: false`。`docforge` 在 `knowledge` 关闭时 PATCH 开 → 400 `knowledge`。启动时若 `docforge` 拿不到 `knowledge`，跳过登记 `doc_*`，不抛。 |
| 联网搜索 | 插件页不出现开关。`PATCH /v1/plugins/web-search` → 400。Composer「联网」与 `runTurn` 过滤 `web_search` 不变。 |
| 个人 MCP | `~/.flintloom/mcp-servers.yml` 在 GET 里 `source: "home"`、`writable: false`。PUT/PATCH/DELETE 该 id（工作区文件无同名覆盖行）→ 400 `home`。提供「复制到工作区」（POST 一条相同字段到工作区文件，工作区覆盖个人）。 |
| `id` 冲突 | 新 MCP `id` 已在 `flintloom.yml` 插件 id、或已在合并后的 MCP id 中 → 400 `id`。与现网合并「yml 已有 id 则跳过 mcp-servers 行」一致，但 UI 保存时拒绝，避免写了不生效。 |
| YAML 写入 | `yaml` `parseDocument` + 与 `installPluginFromPath` 相同的原子替换。尽量保留注释。无文件则创建合法骨架（MCP：`servers: []`）。 |
| 密钥 | MCP `env` 只存变量名。值仍来自工作区 `.env` / `process.env`。界面不写 token。 |
| `flintloom.yml` 手写 MCP 行 | 仍加载。`GET /v1/plugins/declared` 标 `kind: "mcp"`、`toggleable: false`，提示迁到 `mcp-servers.yml`。第一期不提供自动迁移。 |
| 桌面安装 | 设置页「本地目录安装」保持。装成功后该行出现在 `declared` 里，按上表可关。 |
| 提示词 | 第二期：`conversationSystemMessage` 按本轮实际 `tools.schemas()` 裁剪，不点名未注册的 `a2ui_emit` / `infographic_render` / `doc_*`。 |
| 知识库侧栏 | 关 knowledge 后 `/v1/knowledge*` 仍 404。桌面空态：「已在插件页关闭」，文案不得是 `host unreachable`。 |
| 文档预览 | host 预览走 `@flintloom/docforge` 库代码，不依赖插件是否 apply。关掉 `docforge` 只拿掉模型侧 `doc_*`，文件预览仍在。 |
| host 扫描 | `apps/host/src` 仍不得出现 `@flintloom/mcp` 字符串（MCP 失败状态经 kernel 上下文键传递，host 只读抽象表）。 |

## 3. 非目标

- HTTP/SSE MCP、MCP resources / prompts、工具市场、一键安装 npm 包
- 按每一把工具勾选、用户编辑 input schema、「适配向导」
- 聊天框除「联网」以外的工具开关；`fs` / `grep` / `shell` 开关；渠道开关
- 把 token 写入 YAML；在插件页编辑 `.env` 值（可提示去设置页 / `.env`）
- 热插拔到不重载 host（必须走原子 `createRuntime`）
- 改默认根 `flintloom.yml` 增减插件行（本片只加 `enabled` 能力，不改预置清单）
- `flint plugin disable` CLI（可后做，本片 HTTP + 桌面）

## 4. 架构

```text
插件页
  ├─ MCP 块  ←→  GET/POST/PUT/PATCH/DELETE /v1/mcp-servers
  │                 读写 <工作区>/mcp-servers.yml
  │                 只读合并 ~/.flintloom/mcp-servers.yml
  ├─ 可选能力块 ←→  GET /v1/plugins/declared
  │                 PATCH /v1/plugins/:id { enabled }
  │                 写 <工作区>/flintloom.yml 的 enabled
  └─ 内核/渠道块（折叠只读）← GET /v1/plugins/declared 过滤

写 YAML ──►（空闲则）createRuntime 成功 ──► stop 旧 runtime ──► 切换
                │
                ├─ MCP apply 捕获失败 → ctx 状态表 status=error
                ├─ enabled:false 的 MCP 不 merge 进 applyConfig
                └─ enabled:false 的能力行 applyConfig 跳过
```

### 4.1 加载管线（相对现网）

1. `loadConfig` 识别可选 `enabled`：仅 YAML 布尔 `false` 为关；缺省为开；出现但不是布尔 → `throw new Error("enabled")`。
2. `loadMcpServersFile` / `McpServerRow` 增加可选 `enabled`（规则同上）。
3. `mergeMcpServersIntoConfig`：`enabled: false` 的 server **不** `toPluginRow`。已在 `flintloom.yml` 的 id 仍跳过。
4. `applyConfig`：`row.enabled === false` 则 skip（不 import）。
5. `@flintloom/mcp` `apply`：缺 env / initialize 失败改为写入状态表并 return，不让 `applyConfig` 回滚其它行。
6. `createRuntime` 的 `Runtime.plugins` 仍只含实际 apply 的行（与现网 `GET /v1/plugins` 一致）。

### 4.2 MCP 状态表

同一 `@flintloom/mcp` 会 apply 多次（一行一个 server）。第一次 apply 若上下文没有状态表则 `provide` 一张 `Map`。键：server `id`。值：`{ status: "loaded" | "error", error?: string, tools: string[] }`。`tools` 为已登记的 `mcp__<id>__<name>`。host GET 时 `ctx.get` 该表，与 YAML 声明合并。上下文键名由 kernel 导出常量，host **源码**不出现 `@flintloom/mcp` 包名。

### 4.3 可关判定（kernel `pluginKind`）

按 **插件 id**（yml `id` 字段）：

- `kind: "channel"`：id 为 `channel` 或 `channel-*`
- `kind: "mcp"`：该行 `name === "@flintloom/mcp"`（declared 接口可读 name，不把该字符串写进 host 业务分支以外的扫描豁免；判定可放在 kernel 的 `pluginKind(row)`）
- `kind: "search"`：id `web-search`
- `kind: "core"`：§2 内核 id 集合
- 否则 `kind: "optional"`，`toggleable: true`

除 `kind: "optional"` 以外一律 `toggleable: false`。

`pluginKind` 放在 `@flintloom/kernel`，避免 host 复制名单。

## 5. 组件与接口

### 5.1 `GET /v1/mcp-servers`

```json
{
  "servers": [
    {
      "id": "fake",
      "command": "node",
      "args": ["packages/mcp/fixtures/fake-mcp-server.mjs"],
      "env": ["FAKE_TOKEN"],
      "enabled": true,
      "source": "workspace",
      "writable": true,
      "status": "loaded",
      "tools": ["mcp__fake__echo"],
      "error": null
    }
  ]
}
```

`source`：`workspace` | `home`。工作区覆盖个人同 id 后只返回工作区那条。`enabled: false` 时 `status` 为 `disabled`，`tools` 为 `[]`。失败时 `status` 为 `error`，`error` 为短消息。

### 5.2 变更 MCP

| 方法 | 行为 |
|---|---|
| `POST /v1/mcp-servers` | body：`{ id, command, args?, env? }`。追加到工作区文件。然后尝试重载。 |
| `PUT /v1/mcp-servers/:id` | 改工作区该 id 的 `command` / `args` / `env`。不接受 `enabled`（开关只走 PATCH）。个人-only id → 400 `home`。 |
| `PATCH /v1/mcp-servers/:id` | body 只允许 `{ enabled: boolean }`。 |
| `DELETE /v1/mcp-servers/:id` | 从工作区文件删除该 id。个人-only → 400 `home`。 |
| `POST /v1/mcp-servers/:id/copy` | 把个人条目写入工作区（字段原样）。工作区已有该 id → 400 `id`。 |

HTTP 入参校验失败 400（`id` / `command` / `args` / `env` / `home`）——此时 **不写文件**。已落盘的 YAML 里若有坏 command：开机/重载时该行 `error`，不 500。写成功、重载因 busy 失败 → 409 JSON 且 `written: true`。写成功、`createRuntime` 仍失败（flintloom.yml 坏、内核插件抛）→ 500，**旧 runtime 仍在**（先起新再停旧），YAML 保持新内容。原子重载后 `GET /v1/models` 必须仍 200。

成功 200：`{ ok: true, server: <与 GET 单项相同> }`（DELETE 为 `{ ok: true, id }`）。

### 5.3 `GET /v1/plugins/declared`

```json
{
  "plugins": [
    {
      "id": "weather",
      "name": "@flintloom/weather",
      "kind": "optional",
      "enabled": true,
      "toggleable": true
    }
  ]
}
```

不含 `config`。第二期桌面能力块用这个，不靠「已加载列表」猜关掉的行。

### 5.4 `PATCH /v1/plugins/:id`

body：`{ enabled: boolean }`。`toggleable: false` → 400。关 `knowledge` 时同文件写上 `docforge` 的 `enabled: false`。然后与 MCP 相同的原子重载规则。

### 5.5 kernel

- `FlintloomPluginRow.enabled?: boolean`
- `applyConfig` 跳过 `enabled === false`
- MCP 合并跳过禁用 server
- YAML 小工具：在 Document 上设置/删除某 plugin id 或某 mcp id 的 `enabled`，dump 前 `loadConfig` / `loadMcpServersFile` 再校验

### 5.6 `@flintloom/mcp`

- `validateMcpConfig` / `buildChildEnv` / initialize 失败都由 `apply` catch，写入状态表后 return，不让 `applyConfig` 回滚其它行
- 成功则状态 `loaded` + tools；`ctx.effect` 仍在成功路径登记 unregister + kill
- 失败路径：kill 孤儿进程，不 register 工具

### 5.7 桌面 `PluginsPane`

三块，沿用 `settings-pane` 卡片/表格：

1. **MCP 服务器**：空态 +「添加服务器」。工作区卡片：开关、编辑、删除（确认）。展开：command/args/env 名、工具名只读、失败短句。个人卡片：标签「个人」、只读、「复制到工作区」。不提供 schema 编辑。
2. **可选能力**（第二期）：开关列表。知识库与文档成组：关知识库则文档关闭并禁用；旁注原因。无 `web-search` 行；一句「联网在对话输入栏」。
3. **内核与渠道**：默认折叠，只读，无开关。排除 MCP 行（MCP 只出现在第一块）。第一期没有 `declared` 时，这一块继续用 `GET /v1/plugins`，桌面按 `name === "@flintloom/mcp"` 过滤；第二期改用 `declared` 的 `kind`。

页顶：host unreachable / 重载中禁用控件 / 409 busy 条（「已保存，对话结束后重载」+ 按钮）。页脚可写工作区 `mcp-servers.yml` 与 `flintloom.yml` 路径，不当主编辑器。

设置页安装插件、Composer「联网」不搬迁。

### 5.8 loop（第二期）

`conversationSystemMessage` 增加「当前 schema 里有哪些名字」或等价布尔：无 `a2ui_emit` 则去掉 A2UI 句；无 `infographic_render` 则去掉信息图句；无任一 `doc_*` 则去掉「然后 call doc_generate…」句。联网句仍只由 `webSearch` 控制。

## 6. 错误处理

| 情况 | 行为 |
|---|---|
| 无 `mcp-servers.yml` | GET 返回 `servers: []`；POST 创建文件 |
| MCP 缺 env / 超时 / 坏 command | 该行 error；host 起得来；旧 MCP spec 的「拒绝启动」作废 |
| 一台 MCP error、一台 loaded | 仅失败行无工具 |
| `enabled: false` | 不 spawn、不登记、GET 为 disabled |
| 与 yml 插件 id 撞车 | 400 `id`，不写文件 |
| 改个人目录条目 | 400 `home` |
| 关 knowledge 未关 docforge 的手改 yml | `docforge` apply 不 throw；无 `doc_*` |
| PATCH `loop` / `web-search` | 400 |
| 重载时 busy | 409；旧 runtime 继续；若已写 YAML 则 `written: true` |
| `createRuntime` 失败 | 不 stop 旧 runtime |
| 错误日志 / API 消息 | 无 token、无 env 值 |

## 7. 测试

不打网。夹具：`process.execPath` + `fake-mcp-server.mjs`。

### 7.1 第一期

1. kernel：`enabled: false` 的 MCP 不 merge；省略 enabled 则 merge。写回打开状态后文件无 `enabled:` 键。
2. mcp `apply`：缺 `FAKE_TOKEN`、initialize 超时（已有超时夹具或短 timeout 注入）→ 不抛；无 `mcp__*`；同 ctx 上其它插件仍在。
3. host：`reloadRuntime` 在第二次 `createRuntime` 抛错时，随后 `GET /v1/plugins` 仍 200（旧实例）。一台坏 command + 一台假 server：假 server 工具在，坏的 GET mcp-servers 为 `error`，body 无 token。
4. HTTP：POST 假 server 后工作区 yml 含该 id；GET 含 `mcp__fake__echo`；PATCH enabled false 后 schema 无该工具；DELETE 后 GET 无该 id。id 冲突 400。home-only PUT 400。copy 后 `source: workspace`。busy 时 409。
5. 扫描：`apps/host/src` 仍无 `@flintloom/mcp`。
6. 桌面：插件页可渲染 MCP 列表、添加表单、失败状态；不出现第二套「联网」。现有 `GET /v1/plugins` 测试仍绿。

### 7.2 第二期

1. `applyConfig` 跳过 `enabled: false` 的 weather；schema 无 `get_weather`。
2. 关 knowledge：createRuntime 成功；无 `doc_*`；`GET /v1/knowledge` 404。
3. PATCH docforge 开且 knowledge 关 → 400。PATCH knowledge 关 → yml 里 docforge 亦为 false。
4. PATCH `web-search` / `loop` → 400。
5. loop：schema 无 `a2ui_emit` 时 system 不含 `a2ui_emit`。
6. 桌面：能力开关在插件页；Composer 仍有「联网」；知识库空态不含 `host unreachable`。

### 7.3 手工（实现者本机）

第一期：插件页加假 server → 对话调用 echo；改错 command → 对话仍可发、该行红；关开关 → 模型看不到该工具。

第二期：关天气 → 问天气不再走 `get_weather`；关知识库 → 侧栏空态、文档工具消失、预览 md 仍可用。

## 8. 与既有 spec 的关系

- `2026-08-22-flintloom-desktop-plugins-models-design.md`：插件页从只读改为可写；`GET /v1/plugins` 只读语义保留。
- `2026-08-22-flintloom-mcp-design.md`：启动失败策略改为隔离；桌面 MCP 页从非目标改为第一期目标。
- `2026-08-21-flintloom-plugin-add-design.md`：本地安装仍有效；本片补上安装之后的开关。
- `2026-09-03-flintloom-weather-design.md`：管理中心非目标由本片承接；天气工具本身不改。
- `2026-08-29-flintloom-web-search-design.md`：Composer 联网开关不搬。

## 9. 实现顺序

计划拆成两份，互不混进同一 PR 节奏：

1. `docs/superpowers/plans/2026-09-04-flintloom-mcp-server-manager.md`（第一期）
2. `docs/superpowers/plans/2026-09-04-flintloom-optional-plugin-toggles.md`（第二期，依赖第一期的 `enabled` / 原子重载 / YAML 写入）
