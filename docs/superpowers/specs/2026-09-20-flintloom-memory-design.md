# FlintLoom Memory 设计

日期：2026-09-20  
状态：待审阅  
产品：FlintLoom — A real agent. / 真正的 Agent。  
范围：会话窗口治理（压缩 + 旧工具结果占位）+ 跨会话记忆插件 `@flintloom/memory`。从出生就是插件。禁止再往 `createRuntime` 里 `register`。

## 1. 这是什么

FlintLoom 今天的「记忆」只有本会话 JSONL：`runTurn` 用 `system + deriveMessages()` 全量进模型。短对话够用；一长就烧 token、中间内容被淹没；换一条新对话则完全失忆。知识库已经能检索**文档**，Skill 已经能读**怎么干活**，但都不会记住「这个仓库用 pnpm」「提交说明用中文」这类跨会话主张。

本设计把上下文拆成三套真源，禁止并表：

| 真源 | 路径 | 进 prompt |
|---|---|---|
| 本会话事件 | `~/.flintloom/sessions/<工作区键>/<session>.jsonl` | 预算内的最近原文 + 可选摘要；过期 `tool/result` 改占位 |
| 跨会话记忆 | `~/.flintloom/memory.sqlite` | CORE 常驻（硬上限）；笔记按需 `memory_search` / `memory_read` |
| 文档知识 | `~/.flintloom/knowledge.sqlite` | 已有 `knowledge_search`，本片不改语义 |

Memory **只存主张和指针**，不存上传文件正文、Agent 整段回复、生成文件正文。那些继续分别活在工作区、会话日志、可选知识库。

验收（分期，见 §10）：自动化测试不依赖真实 API key；记忆库只写测试用的临时 `homeDir`；yml 去掉 `memory` 行后 schema 无记忆工具、记忆 HTTP 404；`flint` 假 chat 一轮仍绿。

## 2. 收紧的决策

| 点 | 决定 |
|---|---|
| 路线 | 会话窗口治理 + `@flintloom/memory` 插件。不做企业分级记忆金字塔，不每轮自动 RAG。 |
| 切法 | 独立包 `@flintloom/memory`。`provide("memory")` + 登记工具。host 只 `ctx.get("memory")`，`apps/host/src` 禁止 `import "@flintloom/memory"`。 |
| 库位置 | 一份个人库 `join(homeDir, ".flintloom", "memory.sqlite")`。host overlay `runtimeConfigById.memory = { dbPath }`。 |
| 条目标识 | 整数 `id`。`scope` 为 `user` 或 `workspace`（workspace 用当前工作区 realpath，HTTP 不把绝对路径送给桌面）。 |
| 条目形态 | `kind`: `preference` \| `decision` \| `fact` \| `pointer`。`text` 一两句可核对的主张。`refs` 可选：工作区相对路径或 `sessionId`+`turnId`。 |
| 模型侧笔记 | 只走工具。命中复用 `tool/call` + `tool/result`。不加 `memory/hit` 事件。 |
| 工具 | `memory_write`、`memory_search`、`memory_read`、`memory_forget`。禁止参数名 `path`（避免 `ToolRegistry` 对 string `path` 做 `resolveInside`）。文件引用用 `rel`。 |
| 目录提示 | system 可带**有上限的笔记标题列表**（默认最多 20 条，只标题+id+scope，无正文），降低「忘了 search」；yml 无 memory 则不加这段。 |
| CORE | 用户确认后才钉住。默认空。拼进 system 后缀，硬上限 **2048 字节**（UTF-8）。超限 **拒绝**，不截断。只允许增量补丁，禁止整篇重写。 |
| 压缩 | 只压 L0 会话窗口。超预算：抽出 must-keep 要点 → 写一条 `session/compact` 事件 → prompt 用摘要 + 最近原文。磁盘 JSONL **不删**。 |
| 工具结果占位 | 过期且可再取的 `tool/result`（`fs` / `grep` / `knowledge_search` / `memory_search` / `memory_read` 等）在组 prompt 时换成短占位，保留对应 `tool/call`。需要时再调工具。 |
| 笔记压缩 | **禁止**用模型合并/改写 L2 正文当压缩。`search` 只回 snippet；全文必须 `memory_read`。 |
| 错误记忆 | 默认 **软作废**（`status=stale`），可恢复。桌面另提供彻底删除。冲突不覆盖：新条另存，旧条标 stale。 |
| 来源 | 每条 `source`: `user` \| `model`；记下 `channel`、`sessionId`、时间。模型写入 **不能**自动进 CORE。 |
| 通道 | 非桌面通道的「请记住你必须…」不得钉 CORE。 |
| 拒绝入库 | 密钥、`.env` 形态、绝对 `homeDir`、图片二进制、工具原始 JSON、A2UI、堆栈。 |
| 自动抽取 | 回合结束默认 **不**抽记忆。写入必须 `memory_write` 或桌面确认。 |
| 指针新鲜度 | `memory_read` 若 `refs.rel` 指向的工作区文件已不存在，结果带 `missing: true`，不删条。 |
| SQLite | `node:sqlite` 的 `DatabaseSync`。检索优先 FTS5 trigram，无 FTS5 时 `LIKE`；有 embedding kind 时与知识库相同方式做向量加分。 |
| 检索上限 | `memory_search` 默认 top **8**，硬顶 20。 |
| 失败文案 | `failed: …` 或 `aborted`。不得含 API key / host token / 绝对 `homeDir`。 |

## 3. 非目标

- 每轮在 `user/message` 上自动检索并前置到 prompt
- 把文档 embedding、Skill 正文、会话 JSONL 并进同一张记忆表
- 用模型自动合并笔记、自动判定并删除「错误记忆」
- 时序知识图谱、后台 sleep-time 整理、多端同步
- 团队/租户记忆、跨设备云同步
- 把上传文件、生成 docx、整段助手回复写入 `text`
- 改 `deriveMessages()` 的事件→消息投影语义（占位发生在组 prompt 之后的投影层，或 `deriveMessages(opts)` 新增可选参数，默认保持全量供轨迹/UI）
- 往 `createRuntime` 里手工 `register`

## 4. 架构

```text
flintloom.yml  … → knowledge → skill → memory → loop

@flintloom/memory
  provide("memory")     SQLite write / search / read / forget / core
  register memory_write / memory_search / memory_read / memory_forget

loop
  组 prompt：system + CORE? + 标题目录? + compact 摘要 + 预算内消息
  预算内消息：最近原文；过期 tool/result 占位
  磁盘 session JSONL 仍全量追加

工作台 Memory 页              Agent 工具
  GET  /v1/memory              memory_search / read
  POST /v1/memory/forget       memory_forget
  POST /v1/memory/pin          钉 / 撕 CORE（用户）
        │
        ▼
Flint host  只 ctx.get("memory")
```

yml 在 `skill` 之后、`loop` 之前插入一行（loop 需要读 CORE/目录时 `ctx.get("memory")`，缺省当空）：

```yaml
  - id: memory
    name: "@flintloom/memory"
```

yml 去掉该行：启动成功；无记忆工具；记忆路由 404；system 不加 CORE/目录；会话压缩与工具占位仍可用（属 loop，不依赖本插件）。

根 `package.json` 把 `@flintloom/memory` 列为 `devDependencies`（与 fs/grep 一样，供 `import(name)` 从仓库根解析）。

## 5. 组件

### 5.1 一条记忆

```ts
type MemoryScope = "user" | "workspace";
type MemoryKind = "preference" | "decision" | "fact" | "pointer";
type MemoryStatus = "active" | "stale";
type MemorySource = "user" | "model";

type MemoryRef = {
  rel?: string;       // 工作区相对路径，正斜杠
  sessionId?: string;
  turnId?: string;
};

type MemoryRecord = {
  id: number;
  scope: MemoryScope;
  kind: MemoryKind;
  status: MemoryStatus;
  source: MemorySource;
  title: string;      // ≤80 字，目录用
  text: string;       // ≤500 字
  refs?: MemoryRef[];
  channel?: string;
  sessionId?: string;
  createdAt: number;
  updatedAt: number;
};
```

`title` / `text` 超限 → `failed: too large`，不截断、不写行。

### 5.2 `ctx.memory`

```ts
type MemoryService = {
  write(input: Omit<MemoryRecord, "id" | "createdAt" | "updatedAt" | "status"> & {
    status?: MemoryStatus;
    supersedesId?: number;
  }): MemoryRecord;
  search(q: string, opts?: { limit?: number; scope?: MemoryScope }): MemoryHit[];
  read(id: number): MemoryRecord | undefined;
  forget(id: number, mode: "stale" | "purge"): boolean;
  list(opts?: { status?: MemoryStatus }): MemoryRecord[];
  catalog(limit: number): { id: number; title: string; scope: MemoryScope }[];
  coreText(): string;                 // 已钉住、拼好的 CORE，可能为空串
  pin(id: number): { ok: true } | { ok: false; reason: string };
  unpin(id: number): void;
  applyCorePatch(delta: string): { ok: true } | { ok: false; reason: string };
  close(): void;
};
```

`write` 若带 `supersedesId`：该 id 必须存在且 `active`，将其标 `stale`，新条 `active`。旧条不存在 → `failed: not found`，不写新条。

`pin`：把该条 `text` 按增量补丁并入 CORE；合并后 >2048 字节 → `ok: false` `reason=core too large`，CORE 不变。`source=model` 的条 **pin 必须来自 HTTP 用户操作**，工具 `memory_write` 不得直接 pin。

### 5.3 工具

| 工具 | 作用 | 结果 |
|---|---|---|
| `memory_write` | 新增主张 | JSON 含 `id`；或 `failed: …` |
| `memory_search` | `q` 检索 active | `{ q, trust: "unverified", hits: [{ id, title, snippet, scope, kind, source }] }` |
| `memory_read` | 按 `id` 取全文 | JSON 记录（含 `source`、`trust: "unverified"`）；缺文件指针时 `missing: true` |
| `memory_forget` | `id` + `mode` 默认 `stale` | `ok` / `failed: not found` |

`q` 缺省、空、trim 后空、或 >200 → `failed: missing q`。`mode=purge` 仅当调用方是桌面 HTTP；工具侧只允许 `stale`（防止模型物理删）。

### 5.4 会话压缩事件

新增 session 事件（只追加，不改历史行）：

```ts
{ type: "session/compact"; turnId: string; keepPoints: string[]; summary: string }
```

组 prompt 时：若存在更新的 `session/compact`，其之前的 user/assistant 原文不再送模型（工具占位规则仍作用在 compact 之后的步上）。轨迹与 GET session 仍返回全量事件。

`keepPoints` 由压缩步骤先列出必须保留的短句（路径、决策、用户约束），再写 `summary`。测试用夹具断言：给定含「使用 pnpm」的旧轮，compact 后 `keepPoints` 含该事实。

### 5.5 组 prompt（loop）

顺序固定：

1. 人格 `conversationSystemMessage`（现有）
2. CORE：`memory?.coreText()` 非空才追加，前缀固定为 `Pinned memory:` 一行
3. 目录：`memory?.catalog(20)` 非空才追加 `Memory catalog:` 列表
4. 最新一条 `session/compact` 的 `keepPoints` + `summary`（若有）
5. compact 之后的消息；其中过期可再取的 `tool` 角色 content 换成 `[cleared; call the tool again if needed]`

UI / 轨迹继续用全量 `deriveMessages()`，不被占位污染。

### 5.6 HTTP（host 抽 `apps/host/src/memory.ts`）

均需 Bearer。`ctx.get("memory")` 为空 → 404。

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/v1/memory` | 列表（含 stale）；工作区条带 `current: boolean` |
| GET | `/v1/memory/search?q=` | 与工具相同的 hits，无绝对路径 |
| POST | `/v1/memory/forget` | `{ id, mode?: "stale" \| "purge" }` |
| POST | `/v1/memory/pin` | `{ id }` 用户钉 CORE |
| POST | `/v1/memory/unpin` | `{ id }` |
| PUT | `/v1/memory/core` | `{ delta }` 增量补丁；超限 400 `core too large` |

先匹配更长路径，再匹配 `GET /v1/memory`。

### 5.7 Desktop

设置 / 插件 / 模型之外增加 **记忆** 页（或设置页一节，本片选独立页，导航与「知识库」同级）：

- 列表：title · kind · scope · status；stale 可见
- 点一条看 `text` 与 refs
- 按钮：作废、恢复（stale→active）、彻底删除、钉住/撕下 CORE
- CORE 编辑框只提交 `delta`，不提交整篇替换
- 网络失败：`host unreachable`
- 不做 markdown 渲染成知识库替代品

## 6. 什么该写进 Memory

| 内容 | 已有真源 | 进 Memory |
|---|---|---|
| 上传文件正文 | 工作区；可选 `doc_ingest` | 否。最多 `pointer`：`rel` + 一句用途 |
| Agent 整段回复 | `assistant/message` | 否。只抽跨会话决策一两句 |
| 生成文件正文 | 工作区 generation 目录 | 否。最多指针 |
| 偏好 / 提交规范 | 无处 | 是，CORE 或 `preference` |
| 项目惯例 | yml / 文档 | 文档没有才写主张；有则指针 |
| 已拍板选择与原因 | 埋在某次对话 | 是，`decision` + 可选 refs |
| 工具输出、A2UI、堆栈 | session | 否 |
| 密钥、图片二进制 | credentials / 附件事件 | 拒绝 |

用户说「记住这个文件」：正文进知识库或留在工作区；Memory 只写 path + 用途。

## 7. 压缩 / 排毒 / 按需

- **压缩**：只压窗口 + 清可再取的工具载荷。不压笔记事实。CORE 超限拒绝。
- **排毒**：来源标记、拒绝密钥、stale 代替覆盖、模型不能自钉 CORE。`memory_search` / `memory_read` 的 JSON 必带 `trust: "unverified"` 与 `source`，标明未核实笔记，不当 system 圣旨。不做模型私自删除。
- **按需**：默认不灌库。`search ≠ read`。CORE 与标题目录因短而常驻。

## 8. 数据流

1. Boot：yml 加载 memory → 打开 SQLite。
2. 用户发消息 → 追加 JSONL → loop 按 §5.5 组 prompt。
3. 超预算 → 写 `session/compact` → 后续 turn 用摘要 + 最近原文。
4. 模型 `memory_search` → `tool/result` → 需要全文再 `memory_read`。
5. 用户钉 CORE → HTTP pin → 之后每轮 system 带 CORE。
6. 用户作废 → `status=stale`，search 默认不再命中。

## 9. 错误处理

| 情况 | 工具 | HTTP |
|---|---|---|
| 无 Bearer | — | 401 |
| 插件未装 | 无该工具 | 记忆路由 404 |
| 空 q | `failed: missing q` | 400 |
| 超长 text | `failed: too large` | 400 |
| 密钥形态 | `failed: refused` | 400 |
| 未知 id | `failed: not found` | 404 |
| CORE 超限 | 工具不能 pin | 400 `core too large` |
| 模型想 purge | 工具只允许 stale | — |
| 记忆失败 | — | 聊天与知识库不受影响 |

## 10. 分期

| 期 | 交付 | 包 |
|---|---|---|
| 0 | 会话预算、must-keep 压缩、过期 tool/result 占位 | `loop`、`session` |
| 1 | `@flintloom/memory` 四工具 + SQLite + HTTP 列表/作废 + 桌面页 | `packages/memory`、host、desktop |
| 2 | CORE 钉住、标题目录进 system、增量补丁、pin 校验 | memory + loop 读 `ctx.get("memory")` |

期 0 不依赖本插件，可单独上线。

## 11. 测试

- 临时 `homeDir` / 临时工作区。不写开发者真·家目录。
- 不依赖真实 API key：假 chat provider。
- host `src` 扫描不得出现 `@flintloom/memory` 实现 import。
- compact 夹具：旧轮含既定事实 → `keepPoints` 含该句；JSONL 仍有原文事件。
- 占位：旧 `fs` 结果在组 prompt 中被替换；GET session 仍是原文。
- yml 去掉 memory：无四工具；`GET /v1/memory` 404。
- write 拒绝含 `API_KEY=` 的 text。
- supersedes：旧条 stale，新条 active，search 只中新条。
- pin 超 2048 字节失败且 CORE 不变。

## 12. 安全

- 只绑 `127.0.0.1`；token 仍只在 Node 代理。
- HTTP 不返回绝对 `workspaceRoot` / `homeDir`。
- 工作区 `rel` 用现有 `resolveInside`；越界当 missing，不回绝对路径。
