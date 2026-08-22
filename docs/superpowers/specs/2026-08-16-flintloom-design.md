# FlintLoom 设计

日期：2026-08-16  
状态：待审阅草稿  
产品：FlintLoom — 个人 Agent 运行时  
口号：A real agent. / 真正的 Agent。

## 1. 这是什么

FlintLoom 是一套全新的个人 Agent 产品，从零重写。dataagent-v3 和 deepseek-harness 只作参考实现：不启动它们的服务，不引入它们的包，不用 git submodule，不拷贝 `agent-adapter` 或 Cordis 的 vendor 树。

产品在一个仓库里分三层，运行时共用一个 Node 进程：

- **Flint** — 本机 host：工作区、HTTP/SSE、凭证、进程生命周期。
- **Loom** — 插件 harness：session log、turn/step 循环、工具、skill、MCP、channel、文档。
- **Desktop** — 新的 React + 薄 Electron 界面：工作台、个人知识库、文件预览。

第一产品是本机编程助手，同时能在少量 channel 上聊天、产出文档。内核保持可扩展，以后加个人助手或可嵌入运行时，不必再搞第二套 loop。

CLI 二进制：`flint`。仓库：`G:\AgentCode\PerAgent\flintloom`。包名前缀：`@flintloom/*`。

## 2. v1 必须做到

用户在桌面打开一个工作区，发一句话，模型调用工具，回复出现在工作台；文件能预览；个人知识库能入库和检索；Agent 能发出 A2UI 和信息图；DocForge 能解析/转换/生成本地文档；同一套 loop 能在 CLI、webhook、Telegram 上应答。

验收：在真实仓库里发「读 README 并总结」；模型使用 `fs`/`grep`；工作台显示回复；README 能预览；导入的 PDF 可检索；`a2ui_emit` 的 surface 能渲染；命令行 `flint` 能跑完同一轮。

## 3. 架构

```text
                         FlintLoom
                      A real agent.

            ┌──────────────┴──────────────┐
            │                             │
         Flint                         Loom
        本机 Host                    插件 Harness
            │                             │
     工作区 / token / SSE        循环 / 工具 / 通道 / 文档
            │                             │
            └──────────────┬──────────────┘
                           │
                      ctx.models
              按 kind 注册，不按厂商写死
                           │
         chat · omni · asr · tts · t2i · t2v
         embedding · rerank · guard
                           │
              desktop · cli · webhook · telegram
```

Flint 和 Loom 同属一个 TypeScript/Node 进程。桌面只连接 `127.0.0.1`。Channel 是和桌面共用同一 inbox 的插件，不拥有第二套 agent loop。

模型不是 loop 里写死的「一个 LLM」，而是 Loom 上的 **`ctx.models` 注册表**：每一种能力是一个 kind，每种 kind 可以挂多个 provider（云 API、本地、兼容网关）。真正的 Agent 会说话、会看、会听、会画、会检索，也会在动手前被看管；这些都是模型，不是另一套系统。

组装文件：`flintloom.yml`，开机按行 **真正** `import` 并 `ctx.plugin`。每个 Loom 包 default export `apply(ctx)`；登记必须走 `ctx.effect` / `provide` / `hook`，卸载时一并撤销。yml 从上到下即依赖顺序；`ctx.require(key)` 取不到则拒绝启动。学 Cordis 的可逆 effect，不依赖 `@deepseek-ai/cordis`，不 vendor Cordis。

kernel 另提供一条 waterfall：`tools/pre-execute`。工作区确定性闸门永远在 waterfall 之前；`guard` 是 `tools` 插件登记的第一条监听，不能放宽越界路径。host / CLI 只 boot 然后 `ctx.require("loop").runTurn`，不手工 `register` 工具或 chat provider。详情见 [插件组装刀](2026-08-17-flintloom-plugin-composition-design.md)。

## 4. 模型层

真正的 Agent 不只绑一个聊天模型。所有模型走同一套注册，消费者按 **kind + 角色** 解析，不按「DeepSeek / OpenAI」写进 loop。

### 4.1 Kind

| Kind | 作用 | 谁消费 |
|---|---|---|
| `chat` | 多轮对话、工具调用、流式文本 | loop 的每一步 |
| `omni` | 同一模型吃音频/图像/视频并回复 | 多模态 turn、通道里的语音/图片 |
| `asr` | 语音 → 文本 | 桌面语音输入、Telegram 语音 |
| `tts` | 文本 → 语音 | 桌面朗读、语音通道回包 |
| `t2i` | 文生图 | 工具 `image_generate`，产物进工作区 |
| `t2v` | 文生视频 | 工具 `video_generate`，产物进工作区 |
| `embedding` | 向量 | 知识库入库与检索 |
| `rerank` | 重排序 | 知识库命中后再筛 |
| `guard` | 看管工具执行 | tools 闸门，见 4.3 |

一个 provider 插件可以声明多个 kind（例如某 Omni 端点同时报 `chat` + `omni`）。配置里每个 kind 有 **default** 和可选的按场景覆盖（例如「知识库 embedding 用 A，对话 chat 用 B」）。

密钥按 provider 存在 `~/.flintloom/credentials`，桌面只显示该 kind 是否已配置。

### 4.2 v1 与后续

v1 **必须能跑** 的只有 `chat`（OpenAI 兼容流式 HTTP，含 tool call）。注册表和 kind 枚举 **第一天就存在**：未配置的 kind 在解析时明确失败（「未配置 asr」），不许 loop 偷偷拿 chat 去冒充 embedding。

`embedding` / `rerank`：v1 知识库可用 SQLite FTS 关键词检索；配了 embedding 再升级为向量 + 可选 rerank，检索接口不变。

`asr` / `tts` / `t2i` / `t2v` / `omni`：接口与工具预留，v1 不实现 provider。加一个 provider 插件 = 在 `flintloom.yml` 登记，不改 loop。

### 4.3 Guard：保护工具执行

工作区路径、超时、输出上限是 **确定性闸门，永远先跑，guard 不能放宽**。闸门之后走 `tools/pre-execute` waterfall；`guard.gate` 是该事件上的监听，不是写死在 loop 里的分支。

`guard` 是可选的专用模型，用来 **维护和保护工具执行**，不是聊天模型兼职：

1. **执行前（gate）**：看到工具名、参数摘要、工作区、调用方 channel。结论只有 `allow` / `deny` / `ask`（问用户）。`deny` 作为工具错误回给 chat 模型，不执行。
2. **执行后（steward）**：看工具结果是否异常（明显越权、密钥形态、破坏性删除）。可以记下事件、建议禁用该工具，v1 只记 log，不自动卸载插件。

Guard 的输入输出都进 session log（不含密钥原文）。未配置 `guard` 时，只走确定性闸门，Agent 仍可干活。

Guard **不是** 企业审批流，也 **不是** 用同一个 chat 模型再问一句「你确定吗」。它是 `ctx.models` 上的独立 kind，可换成更小、只做分类的本地模型。

## 5. 包划分

每个 Loom 包（下表 `packages/*`，不含 `apps/*`）必须 default export `{ name, apply(ctx) }`。host / CLI 只负责 boot 与 I/O，不 import 工具工厂。

| 包 | 职责 |
|---|---|
| `packages/kernel` | `ctx`（provide / require / effect / hook / waterfall）、按 yml 加载/卸载 |
| `packages/session` | 只追加的 session log；`ctx.sessions`；模型历史从 log 投影 |
| `packages/loop` | `ctx.loop.runTurn`；向 `ctx.models` 要 `chat`，不直连厂商 SDK |
| `packages/models` | `ctx.models` 注册表：kind、default、凭证引用、解析失败即报错 |
| `packages/models-chat` | v1：OpenAI 兼容对话 / 工具调用 / 流式 HTTP |
| `packages/tools` | `ctx.tools`；确定性闸门 + `tools/pre-execute`（含可选 `guard` 监听） |
| `packages/fs`、`grep`、`shell` | 工作区沙箱内的编程工具 |
| `packages/skill` | 本地 skill 目录 + `skill` 工具 |
| `packages/mcp` | 配置里一行一个 MCP server；工具以 `mcp__<server>__<name>` 登记到 `ctx.tools` |
| `packages/channel` | 通道登记表：本片 `register` + `inbound`；`send` / `deliver` 出站留后续 |
| `packages/channel-desktop` | 工作台 SSE（本片不迁入 `ctx.channels`） |
| `packages/channel-cli` | `flint` 标准输入输出（本片不迁入 `ctx.channels`） |
| `packages/channel-webhook` | 本机 HTTP 收消息：适配器经 `inbound("webhook")` 调 `runTurn` |
| `packages/channel-telegram` | Telegram 长轮询：适配器经 `inbound("telegram")` 调 `runTurn`，再 `sendMessage` 回同一 chat |
| `packages/docforge` | 本地文档：探测/解析/入库/转换/生成/编辑/对比/摘要 |
| `packages/a2ui` | A2UI v0.9 envelope、`a2ui_emit`、action 续跑 |
| `packages/infographic` | 工作区里的 `*.infographic.json`；get/patch 工具；共用渲染器 |
| `packages/knowledge` | 个人 SQLite 知识库；入库走 DocForge |
| `apps/host` | Flint HTTP，监听 `127.0.0.1:7331` |
| `apps/desktop` | 工作台、知识库、预览、A2UI host、信息图视图 |
| `apps/cli` | `flint` |

没有单独的 `packages/files` 解析器。预览 UI 调用 DocForge（以及信息图渲染器）。知识库导入调用 DocForge ingest。

插件分发（不自建市场后台）：`flint plugin add <path|git|npm>` 把 bundle 写入 profile，并在 `flintloom.yml` 加一行。目录浏览在各自源网站完成。

## 6. 一轮对话怎么走

**step** 是一次模型请求加上它调用的工具。**turn** 是一个或多个 step，直到不再欠模型一步。

```text
POST /v1/turns  { sessionId, text }
  向 session log 追加 user/message
  组装 prompt：系统段 + log 投影 + 当前工具 schema
  向 ctx.models 解析 kind=chat 的默认模型并流式请求
    chunk            → SSE
    a2ui_emit        → 校验 → 写入 log 的 a2ui.surface → SSE
    其它 tool_call   → 工作区确定性闸门 → tools/pre-execute（含可选 guard.gate）→ 执行
                     → 可选 guard.steward → tool/result 写入 log
    若还欠模型一步   → 下一 step
  追加 assistant/message
  turn/end
```

**模型看见的，必须先记进 log。** 知识库命中、skill 正文、DocForge 摘要都先写成 session 事件，再进入 prompt。投影器只发送当前 step 需要的内容。这是实现原则，不是门面口号。没有单独的压缩服务。ASR 转写、生图路径等一旦发生，也先落 log 再给 `chat`/`omni` 看。

桌面断开或 `POST /v1/turns/:id/cancel` 会中止 LLM 和正在跑的工具。该 turn 标记为 `cancelled`。

## 7. 本机 HTTP API

所有路由只绑定回环地址，并要求 `~/.flintloom/credentials` 里的 host token。

工作台：

- `POST /v1/turns` — SSE 事件：`chunk`、`tool`、`a2ui.surface`、`error`、`end`
- `GET /v1/sessions/:id` — 从 log 重放
- `POST /v1/turns/:id/cancel`
- `POST /v1/turns/:id/actions` — A2UI 客户端动作；写入 log；继续同一 turn

Webhook（yml 挂上 `@flintloom/channel-webhook` 才存在）：

- `POST /v1/hooks` — 等到 turn 结束返回 JSON `{ turnId, status, text }`（见 [webhook 通道设计](2026-08-20-flintloom-channel-webhook-design.md)）

文件与文档：

- `GET /v1/files?path=`
- `GET /v1/files/preview?path=` — DocForge 或信息图渲染器
- DocForge 工具也会在 turn 内被 Agent 调用。UI 的解析/入库走同一套函数，不另开第二条流水线。

知识库：

- `POST /v1/knowledge/import`
- `GET /v1/knowledge`
- `GET /v1/knowledge/search?q=`
- Agent 入库用 `doc_ingest`，检索用 `knowledge_search`（命中经 `tool/result` 进 session）。不自动 RAG。

插件、通道与模型：

- `GET /v1/plugins`
- `GET /v1/models` — 已登记的 kind、是否已配置 default、不返回密钥
- 通道启停由配置 + host 启动决定；Telegram/webhook 的密钥留在插件配置里，永不进入 session log

## 8. A2UI 与信息图

A2UI 使用公开的 v0.9 协议。类型和 React host 在本仓编写（允许官方 `@a2ui/react`；不允许搬 dataagent 的 `renderer/src/a2ui`）。本片落地见 [A2UI 交互核心设计](2026-08-17-flintloom-a2ui-design.md)：本仓子集 host、catalogId `flintloom:a2ui:core`、同一 turn 新 SSE 续跑。

v1 组件目录：text、markdown、button、choice、data table、chart、infographic。交互核心刀：Column / Row + Text / Markdown / Button / ChoicePicker。table / chart / infographic 后续。

`a2ui_emit` 校验 envelope。非法 JSON 作为工具错误返回给模型。用户操作会继续这一轮（不是只审计不执行）：`POST /v1/turns/:id/actions` + `continueTurn`，不挂起第一轮 HTTP。

信息图以工作区文件存在（`*.infographic.json`）。工具：`infographic_get`、`infographic_patch`。工作台预览和 A2UI 的 infographic 组件共用一个本地渲染器。禁止拉取远程 icon/CDN。SVG 必须消毒。超大 payload 直接拒绝。本片落地见 [信息图盒线核心设计](2026-08-17-flintloom-infographic-design.md)：盒线图、操作列表 patch、Files 预览 `kind: "svg"`；A2UI Infographic 组件仍留后续。

## 9. Channel

除桌面通道所使用的 host API 外，入站只走 `ctx.channels`。Webhook 的 listen / hostToken 仍由 host 拥有；**turn 入站**走 `ctx.channels.inbound("webhook")`。见 [webhook 通道设计](2026-08-20-flintloom-channel-webhook-design.md)。Telegram 的 `getUpdates` 由插件拥有，仅 `startHost` overlay 才轮询；**turn 入站**走 `ctx.channels.inbound("telegram")`。见 [Telegram 通道设计](2026-08-20-flintloom-channel-telegram-design.md)。桌面 `POST /v1/turns` 与 CLI 不迁入该接口。`channels.send` 仍后续。

v1 内置通道：desktop、cli、webhook、telegram。ACP 作为同一接口上的可选插件。Slack、Discord、邮件、飞书以及 ZeroClaw 其余通道不进 v1，以后按插件挂载。

入站附件先存进工作区，需要时再经 DocForge 解析。Telegram 和 webhook 只发送文本和文件路径，不推送完整 A2UI 树。本片 webhook 与 Telegram 都只收文本；Telegram 出站是 `sendMessage` 文本，不是登记表 `send` API。

## 10. DocForge

本地文档引擎。没有 S3、没有云对象存储、没有治理/脱敏平台、没有 OCR 服务。抽不出文本的扫描件 PDF 标记为 `failed`。

| 工具 | 行为 |
|---|---|
| `doc_probe` | 类型、页数、是否可解析 |
| `doc_parse` | pdf / docx / pptx / xlsx / html / md → 结构化 markdown |
| `doc_ingest` | 解析后写入个人知识库 |
| `doc_convert` | 可 parse 的六种源 → md / html / docx / pdf，成功 JSON 带固定 `loss`（见 [转换设计](2026-08-18-flintloom-docforge-convert-design.md)）。写出 xlsx/pptx 仍留后续 |
| `doc_generate` | 工作区 markdown → md / html / docx / pdf（见 [生成设计](2026-08-17-flintloom-docforge-generate-design.md)）。从结构化数据生成仍留后续 |
| `doc_edit` | 工作区 markdown 一次精确唯一替换并原地覆盖（见 [编辑设计](2026-08-18-flintloom-docforge-edit-design.md)）。pdf/docx 仍先 convert |
| `doc_compare` | 两份文档 parse 成 markdown 后行级 unified diff，成功 JSON 不写盘（见 [对比设计](2026-08-19-flintloom-docforge-compare-design.md)） |
| `doc_summarize` | 基于 parse 结果 + 内层 chat；摘要 JSON 写入 log，全文不塞进下一次 prompt（见 [摘要设计](2026-08-19-flintloom-docforge-summarize-design.md)） |

聊天附件、知识库导入、预览都调用这个包。

## 11. 错误处理

| 失败 | 行为 |
|---|---|
| 工作区没有 / 损坏 `flintloom.yml`、插件 `import`/`apply` 失败、`id` 重复、`require` 缺失 | 进程拒绝启动 |
| 未配置 `chat` | 进程允许启动；该 turn 失败并写 `model/error` |
| 某 step 需要的 kind 未配置（如 asr） | 该次调用失败并写 log；不拿 `chat` 冒充 |
| `chat` HTTP 错误 | SSE 发 `error`，turn 标 `failed`，log 记一条失败事件；同一 turn 不静默换模型 |
| `guard` 返回 `deny` | 不执行工具；工具错误回给 `chat`；turn 继续 |
| `guard` 返回 `ask` | 暂停工具，桌面确认后再执行或取消 |
| 流中断或桌面断开 | 取消 LLM 和工具；turn 标 `cancelled` |
| 工具抛错 / 非 0 退出 / 超时 | 把工具结果回给模型；turn 继续 |
| 预览 / 解析失败 | 该文件或知识库条目为 `failed`；聊天不受影响 |
| 知识库部分入库失败 | 按文件记状态；成功的可检索 |

`GET /v1/sessions/:id` 始终从 log 重放。

## 12. 安全

- 只绑定 `127.0.0.1`。必须带 host token。
- `fs` / `grep` / `shell` 的路径经 realpath 后必须落在所选工作区内。越界视为工具错误。
- Shell 在工作区中运行，有超时和输出上限。v1 不上 Docker/Landlock。
- API 密钥放在 `FLINTLOOM_API_KEY` 或 `~/.flintloom/credentials`，按 provider 分条。永不进入 session log、SSE 或知识库。桌面只显示各 kind「已配置 / 未配置」。
- 确定性工作区闸门优先于 `guard`。`guard` 只能加严，不能批准越界路径。
- MCP 子进程只获得其配置行声明的环境变量。
- Skill 和自定义插件只从显式的 `plugin add` 或 yml 路径加载。模型不能靠在聊天里写 URL 来安装代码。
- A2UI action 不能逃出工作区。信息图渲染不能加载网络资源。

## 13. 桌面

全新应用。交互参考 dataagent 的工作台 + 个人知识库 + 预览，不拷贝那份代码。没有市场、流程中心、数字员工、团队/部门知识库、登录或 BFF。

界面：聊天工作台（含内联 A2UI）、文件树 + 预览、个人知识库、插件列表（只读状态）、模型页（按 kind 配置 default，不堆厂商营销页）。

## 14. 测试

- loop 用假 `chat`：用户 → 读文件 → 回复。
- yml 省略某工具插件则 schema 无该工具；dispose 后登记撤销。
- 未配置的 kind 解析失败，且不得回退到 `chat`。
- `guard.deny` 时工具进程未启动（闸门在 `tools/pre-execute` 之前仍拦截越界路径）。
- 不变量：请求里每一段模型可见字符串都能从 session log 重建。
- DocForge：md/docx/pdf 的解析与转换夹具（外加一份失败的二进制）。
- A2UI：拒绝非法 envelope；接受带按钮的 surface，并在 action 后续跑。
- Channel：webhook POST 与 Telegram `inbound` 经同一套 `runTurn` 写入 session 事件。同一 `text`、无 A2UI wait 时与 `channel: "host"` 事件同构；hooks / Telegram 对 `text` 的 trim 与 `/v1/turns` 不同。见 [webhook 通道设计](2026-08-20-flintloom-channel-webhook-design.md) 与 [Telegram 通道设计](2026-08-20-flintloom-channel-telegram-design.md)。
- 桌面：用固定 SSE 夹具渲染气泡，不依赖真实 API key。

## 15. v1 不做

- 云、登录、租户、审批、市场后台、gateway、BFF
- 引入或运行 dataagent-v3、deepseek-harness
- 团队/部门知识库、流程中心、DocForge 云端治理
- 把三十多个聊天平台做进本仓
- 把 Claude Code / OpenClaw / 其它产品包成子 Agent
- 独立的上下文压缩产品、自动「小模型先上」路由产品（kind 的 default 由用户显式配置）
- v1 内实现 asr / tts / t2i / t2v / omni 的 provider（kind 与解析规则要在）
- 托管 runner、把多人协同当作真源

## 16. 实现顺序

一个产品，按此顺序（每一刀结束时 `flint` 必须能跑）：

1. Kernel + session + loop + `ctx.models` + `models-chat` + fs/grep/shell + host + CLI — 一轮编程对话。当时 host 手工 `register`（已交付）。
1.5. **插件组装** — yml 真正加载、`apply` / `effect` / `require`、loop 作为插件、`tools/pre-execute`。host/CLI 不再手工 register。见 [插件组装设计](2026-08-17-flintloom-plugin-composition-design.md)。
2. 桌面工作台 + 预览 + DocForge 解析（已交付，见 [文件预览设计](2026-08-17-flintloom-files-preview-design.md)）；个人知识库 + `doc_ingest`（**从出生就是插件**，见 [知识库设计](2026-08-17-flintloom-knowledge-design.md)）。
3. A2UI 交互核心（见 [A2UI 设计](2026-08-17-flintloom-a2ui-design.md)）+ 信息图（见 [信息图设计](2026-08-17-flintloom-infographic-design.md)）+ 其余 DocForge 工具（生成见 [生成设计](2026-08-17-flintloom-docforge-generate-design.md)；转换见 [转换设计](2026-08-18-flintloom-docforge-convert-design.md)；编辑见 [编辑设计](2026-08-18-flintloom-docforge-edit-design.md)；对比见 [对比设计](2026-08-19-flintloom-docforge-compare-design.md)；摘要见 [摘要设计](2026-08-19-flintloom-docforge-summarize-design.md)）— 均为插件，不改 host 组装。A2UI 核心与信息图 / 其余 DocForge 分开写计划。table / chart / Infographic 组件与 xlsx/pptx 写出仍留后续。
4. Webhook 通道（见 [webhook 通道设计](2026-08-20-flintloom-channel-webhook-design.md)）+ Telegram 通道（见 [Telegram 通道设计](2026-08-20-flintloom-channel-telegram-design.md)）+ `flint plugin add`（见 [安装器设计](2026-08-21-flintloom-plugin-add-design.md)）。
5. Skill（见 [Skill 设计](2026-08-22-flintloom-skill-design.md)）— 本地目录 + `skill` 工具，不改 `runTurn`。
6. MCP（见 [MCP 设计](2026-08-22-flintloom-mcp-design.md)）— stdio + tools，一行一个 server，工具名 `mcp__<id>__<name>`。桌面插件/模型页、A2UI table/chart、guard `ask` 仍留后续。

第 2–6 刀在同一份总 spec 上继续拆计划。新 Loom 包必须带 `apply`，禁止再往 `createRuntime` 里堆 `register`。
