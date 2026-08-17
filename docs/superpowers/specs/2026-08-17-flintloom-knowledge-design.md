# FlintLoom 个人知识库设计

日期：2026-08-17  
状态：待审阅  
产品：FlintLoom — A real agent. / 真正的 Agent。  
范围：总 spec 第二刀的 **知识库块**。插件 `@flintloom/knowledge`、工具 `doc_ingest` / `knowledge_search`、HTTP 三路由、工作台右侧 Knowledge 页。从出生就是插件：禁止再往 `createRuntime` 里 `register`。

## 1. 这是什么

个人知识库只有一份 SQLite，放在 `~/.flintloom/knowledge.sqlite`（相对 host/CLI 传入的 `homeDir`）。入库路径仍必须落在**当前工作区**内。工作台能列出、搜索、把选中文件 Import；Agent 用 `doc_ingest` 入库、用 `knowledge_search` 检索。检索命中先成为已有的 `tool/result` session 事件，再进入 prompt。不改 `runTurn`，不在每条用户消息上自动 RAG。

验收：`pnpm desktop` 打开工作台，Files 里点 `README.md`，切到 Knowledge，Import 后列表出现该 path；搜索标题或正文能命中；同一路径再 Import 覆盖而非新增。`flint` 仍能跑完一轮编程对话。自动化测试不依赖真实 API key，库文件只写测试用的临时 `homeDir`。

## 2. 复核后收紧的决策

| 点 | 决定 |
|---|---|
| 切法 | 独立 `@flintloom/knowledge`（库 + `knowledge_search`）。`doc_ingest` 仍属 DocForge：先 `parse`，再 `ctx.knowledge.ingest`。 |
| 库位置 | 一份个人库，不是按工作区分文件。唯一键 `(workspace_root, rel_path)`。 |
| 模型侧 | 只走工具。UI 搜索不写 session、不发 turn。 |
| 命中进 prompt | 复用 `tool/call` + `tool/result`。本片不加 `knowledge/hit` 事件。 |
| SQLite | Node `node:sqlite` 的 `DatabaseSync`。不引入 `better-sqlite3`。 |
| 检索 | 优先 FTS5 `tokenize='trigram'`（中英子串）。当前 Node 未编 FTS5 时退化为转义后的 `LIKE`。对外 JSON 相同。 |
| 去重 | 同一工作区同一相对路径再入库 = 覆盖（含 failed→ok）。本片无删除 API。 |
| 隐藏路径 | 与文件树同一套规则。**不写行**（密钥不得出现在列表里）。 |
| 不存在 / 目录 | 不写行。 |
| parse 失败 | 写 `status=failed`，不可搜。 |
| 工作区标签 | HTTP/UI 用 `current: boolean`（是否等于本进程工作区 realpath），不把绝对 `workspaceRoot` 送给桌面。 |
| 隐藏规则代码 | `isHiddenRelPath` 从 host 挪到 `@flintloom/tools`，预览与入库共用。 |

## 3. 非目标

- embedding、向量索引、自动 RAG、改 `runTurn` 去检索
- 删除 / 分页 / 批量文件夹入库
- 团队/部门知识库
- markdown 渲染、拖拽分栏、Electron 工作区选择器
- `flint plugin add`、MCP、skill、A2UI、信息图、其余 DocForge 工具
- 把 HTTP 路由做成插件
- 引入 dataagent-v3 / deepseek-harness / Cordis

## 4. 架构

```text
flintloom.yml  … → knowledge → docforge → loop

@flintloom/knowledge
  provide("knowledge")     SQLite ingest / search / list
  register knowledge_search

@flintloom/docforge
  require("knowledge")
  register doc_probe / doc_parse / doc_ingest

工作台 Knowledge 页          Agent 工具
  GET  /v1/knowledge          doc_ingest
  GET  /v1/knowledge/search   knowledge_search
  POST /v1/knowledge/import
        │
        ▼
Flint host  只 ctx.get("knowledge")
  禁止 import @flintloom/knowledge
  预览仍只调 DocForge 纯函数
```

yml 从上到下即依赖顺序。默认列表在 1.5 刀的 `docforge` 之前插入一行：

```yaml
  - id: knowledge
    name: "@flintloom/knowledge"
  - id: docforge
    name: "@flintloom/docforge"
```

`@flintloom/docforge` 的 `apply` **必须** `require("knowledge")`。yml 有 docforge、无 knowledge → 拒绝启动。yml 去掉 knowledge（也去掉或改掉 docforge）→ 启动成功；三路由 404；schema 无 `knowledge_search` / `doc_ingest`。

根 `package.json` 把 `@flintloom/knowledge` 列为 `devDependencies`（与 fs/grep 一样，供 `import(name)` 从仓库根解析）。

## 5. 组件

### 5.1 `ctx.knowledge`

`createRuntime` **始终** overlay（有无 API key 都写）：

```ts
runtimeConfigById.knowledge = {
  dbPath: join(homeDir, ".flintloom", "knowledge.sqlite"),
};
```

插件 `config.dbPath` 缺失时回落 `join(os.homedir(), ".flintloom", "knowledge.sqlite")`。打开前 `mkdir` 父目录。`stop()` 关闭数据库。

```ts
type KnowledgeStatus = "ok" | "failed";

type KnowledgeRecord = {
  id: number;
  path: string;            // 正斜杠相对路径
  title: string;
  status: KnowledgeStatus;
  ingestedAt: number;      // unix ms
  workspaceRoot: string;   // realpath，不出 HTTP
  failReason?: string;
};

type KnowledgeIngestInput = {
  workspaceRoot: string;
  relPath: string;
  title: string;
  status: KnowledgeStatus;
  body: string;            // failed 时为空串
  failReason?: string;
};

type KnowledgeService = {
  ingest(input: KnowledgeIngestInput): KnowledgeRecord;
  search(q: string): { id: number; path: string; title: string; snippet: string; workspaceRoot: string }[];
  list(): KnowledgeRecord[];
};
```

host 在序列化前用本进程工作区 `realpath` 与 `workspaceRoot` 比较，加上 `current`，**去掉** `workspaceRoot`。工具结果 JSON 不含 `current` / `workspaceRoot`，含 `id`、`path`、`title`；search 另含 `snippet`。

`apps/host/src` 用结构相同的本地类型描述 `ctx.get("knowledge")`，**不要** `import "@flintloom/knowledge"`（连 `import type` 也不要，否则源码扫描失败）。`@flintloom/docforge` 可以依赖该包，仅引用 `KnowledgeService` 类型并把实例注入 `createDocIngestTool`。

`list()`：`ORDER BY ingested_at DESC LIMIT 200`，含 failed，**不含 body**。

`search(q)`：只搜 `status=ok`。最多 **8** 条。`q` 按字面量子串，不是 FTS 语法：去掉首尾空白；长度 1–200；FTS 特殊字符用双引号包裹并把内部 `"` 加倍。`LIKE` 路径把 `%`、`_`、`\` 转义。snippet：在 `body` 里找 `q` 的首次出现（大小写不敏感），取前后合计约 **240** 字符，超出加 `…`；只命中 title 则 snippet 为 body 前 240 字符。

`ingest`：`INSERT … ON CONFLICT(workspace_root, rel_path) DO UPDATE`。`status=ok` 时写入/更新 FTS；`failed` 时从 FTS 删掉该 rowid。

### 5.2 表

```sql
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY,
  workspace_root TEXT NOT NULL,
  rel_path TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  fail_reason TEXT,
  ingested_at INTEGER NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  UNIQUE(workspace_root, rel_path)
);
```

FTS（若 `CREATE VIRTUAL TABLE … USING fts5` 成功）：

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
  title,
  body,
  content='documents',
  content_rowid='id',
  tokenize='trigram'
);
```

`workspace_root` 存入库时工作区的 `realpath` 字符串。`rel_path` 由该 realpath 算出，正斜杠，不要 `./` 前缀。

### 5.3 入库管道（UI Import 与 `doc_ingest` 同一条）

输入：当前工作区 root + 用户/模型给的 path。顺序命中即停：

1. `exec.signal.aborted` → 返回 `aborted`，不写行（HTTP 不走 abort，忽略）。
2. path 不是非空字符串 → 工具 `failed: missing path`；HTTP 400。
3. `resolveInside` 越界 → 抛 `WorkspaceEscapeError`（HTTP 400，body 为错误信息）。
4. 用与预览相同的 `isHiddenRelPath` 检查**请求相对路径**和 **realpath 后的相对路径** → `failed: hidden`，不写行。HTTP 200：`{ "path", "status": "failed", "failReason": "hidden" }`（无 `id`）。
5. 目标不存在 → 工具 `failed: not found`；HTTP **404**，不写行。
6. 目标是目录 → 工具 `failed: not a file`；HTTP 400，body `failed: not a file`，不写行。
7. `parse(absPath)`（现有 DocForge，已截断 200_000）。
8. 结果以 `failed:` 开头 → `ingest` `status=failed`，`body=""`，`failReason` 为前缀去掉后的其余部分（如 `empty text`）。HTTP 200 带 `id`。
9. 否则 `title` = 正文里第一条 `^#\s+(.+)$`（m 标志）的捕获，trim；没有则用 `rel_path` 的 basename。`status=ok`，`body` 为 parse 全文。

`doc_ingest` 成功返回一行 JSON（无空白换行要求，`JSON.parse` 即可）：

```json
{"status":"ok","id":1,"path":"notes/a.md","title":"Notes"}
```

failed 行：

```json
{"status":"failed","id":2,"path":"scan.pdf","title":"scan.pdf","failReason":"empty text"}
```

`createDocIngestTool(kb)` 闭包持有 `KnowledgeService`。`apply` 里 `ctx.require("knowledge")` 再 `register`。host **禁止** import `createDocIngestTool`。

### 5.4 `knowledge_search`

`@flintloom/knowledge` 登记。参数 `{ q: string }`。`q` 缺失、非字符串、trim 后为空或长于 200 → `failed: missing q`。成功：

```json
{"q":"notes","hits":[{"id":1,"path":"notes/a.md","title":"Notes","snippet":"…"}]}
```

无命中：`hits` 为空数组。不把 `body` 全文放进工具结果。

### 5.5 Host HTTP

先匹配 `GET /v1/knowledge/search`，再匹配 `GET /v1/knowledge`，避免前缀吃掉。均需 Bearer。`ctx.get("knowledge")` 为空 → 三路由 **404**。

`POST /v1/knowledge/import` body：

```json
{ "path": "notes/a.md" }
```

`path` 用现有 `normalizeRelPath`。成功 200：

```json
{ "id": 1, "path": "notes/a.md", "title": "Notes", "status": "ok" }
```

failed 已写行时 200，带 `id`、`status`、`failReason`。hidden 见上（无 `id`）。

`GET /v1/knowledge`：

```json
{ "items": [{ "id": 1, "path": "notes/a.md", "title": "Notes", "status": "ok", "ingestedAt": 0, "current": true }] }
```

`status=failed` 时另有 `failReason`。

`GET /v1/knowledge/search?q=`：

```json
{ "hits": [{ "id": 1, "path": "notes/a.md", "title": "Notes", "snippet": "…", "current": true }] }
```

`q` 缺省、空、或 trim 后空 → 400。可抽 `apps/host/src/knowledge.ts`，内部只调 `KnowledgeService`，不 import 该包实现。

host `src`（`apps/host/src` 下全部 `.ts`）不得出现 `@flintloom/knowledge`、`createDocIngestTool`。现有 factory 测试改为扫描整个 `src` 目录。

### 5.6 Desktop

右侧现有栏顶上 **Files | Knowledge**。Files 语义不变。

Knowledge：

- 搜索框：空 → `GET /v1/knowledge`。有字 → `GET /v1/knowledge/search?q=`（debounce 可有可无，本片不强制）。只刷新本页。
- 列表：`path · status`；`current === false` 时加「其它工作区」。失败条可见。
- 点一条：下方显示该条的 `snippet`（search 命中）或 list 的 `failReason` / 占位「已入库」。不插入输入框、不发送。
- 底栏：Files 里**最后一次点过的文件**相对路径 + Import。从未点过文件 → Import `disabled`。点目录不更新该路径。
- Import：`POST /v1/knowledge/import`，成功或失败都刷新列表。
- 网络失败：本页文案 `host unreachable`（与文件树同一英文）。
- 不做 markdown 渲染、不做删除按钮。

## 6. 数据流

1. Boot：yml 加载 knowledge → 打开 SQLite → docforge `require("knowledge")` 并登记 `doc_ingest`。
2. 工作台打开 Knowledge：`GET /v1/knowledge`。
3. 用户在 Files 点 `notes/a.md` → 预览 + 插入输入框（现有）；记住该 path。
4. Knowledge 底栏 Import → `POST /v1/knowledge/import` → parse → ingest → 刷新列表。
5. 用户在搜索框输入 → `GET /v1/knowledge/search?q=` → 只更新 Knowledge 页。
6. 模型调用 `knowledge_search` → `tool/result` 写入 session → 投影进下一 step。模型调用 `doc_ingest` 走同一入库函数。

## 7. 错误处理

| 情况 | 工具 | HTTP |
|---|---|---|
| 无 Bearer | — | 401 |
| knowledge 插件未装 | 无该工具 | 三路由 404 |
| 越界 | 抛 `WorkspaceEscapeError` | 400，现有越界文案 |
| 隐藏 | `failed: hidden`，不写行 | 200 JSON `status=failed` `failReason=hidden`，无 id |
| 不存在 | `failed: not found`，不写行 | 404 |
| 目录 | `failed: not a file`，不写行 | 400 `failed: not a file` |
| parse 失败 | JSON `status=failed`，已写行 | 200 同上 |
| import 缺 / 非法 path | — | 400 |
| search 空 `q` | `failed: missing q` | 400 |
| 重复入库 | 覆盖同一 `(workspace_root, rel_path)`，**保留原 id** | 200 |
| 知识库失败 | — | 聊天与 Files 不受影响 |
| 聊天失败 | — | Knowledge 页不受影响 |

SQLite `ON CONFLICT DO UPDATE` 保留原 `id`。测试断言：path 相同则 id 不变，正文更新。

## 8. 安全

- 只绑 `127.0.0.1`；token 仍只在 Node 代理。
- 入库前 `resolveInside`；隐藏规则与预览相同（basename 段，禁止只靠 `extname(".env")`）。
- API 密钥不进 session log、SSE、yml、知识库 body、list/search JSON。
- 桌面收不到绝对 `workspaceRoot`。
- 工具结果只有 snippet，没有全文。

## 9. 测试

全部不依赖真实 API key。knowledge 测试传入临时目录作为 `dbPath` / `homeDir`。

1. 入库 md → list 含该 `path` 且 `status=ok`；search 能命中标题或正文；同路径再入 → **id 不变**、正文与 title 更新。
2. parse 失败（空文件或 `binary.bin` 夹具）→ `status=failed`，search 无此 id。
3. `.env`、`secret.env`、`node_modules/pkg/x.js` → `failed: hidden`，list 无该 path。`.env.example` 允许入库。
4. `doc_ingest` 越界抛 `WorkspaceEscapeError`；缺 path → `failed: missing path`；已 abort → `aborted`。
5. `knowledge_search` 命中 JSON 含 snippet、**不含**入库全文；空 `q` → `failed: missing q`。
6. HTTP：import 200；缺文件 404；无 token 401；yml 去掉 knowledge（及 docforge，以免 boot 失败）→ 三路由 404。
7. 桌面：mock fetch，Files | Knowledge 可切换；列表出现夹具 path；空选中时 Import disabled；点过文件后 Import 的 fetch URL 含 `/v1/knowledge/import` 且 body.path 正确。不启真实 host。
8. host `src` 全目录无 `@flintloom/knowledge`、`createDocIngestTool`。
9. knowledge 插件 `stop()` 后 schema 无 `knowledge_search`，再次 `ingest` 不可用（库已关或 provide 已撤）。
10. 现有预览隐藏用例、`flint` / loop 假 chat 用例保持绿。

## 10. 与总 spec / 前切片的关系

总 spec 的 `POST /v1/knowledge/import`、`GET /v1/knowledge`、`GET /v1/knowledge/search?q=`、`doc_ingest`、个人 SQLite、UI 与 Agent 共用 DocForge 本切片落地。预览 HTTP/UI 语义不变。插件组装契约不变：只加 yml 行与 overlay，不改 kernel。

总 spec「知识库命中先写成 session 事件」本切片解释为：`knowledge_search` 的 `tool/result` 即该事件。embedding 以后换 search 内部实现，HTTP 与工具 JSON 形状保持。

## 11. 实现顺序（本刀内）

每一项结束时现有 `pnpm test` 保持可跑（或该步测试先红后绿）：

1. `isHiddenRelPath` 迁到 `@flintloom/tools`；host `files.ts` 改 import；现有 files 测试绿。
2. `@flintloom/knowledge`：打开库、ingest/search/list、FTS/`LIKE`、插件 `apply` + `knowledge_search`。
3. DocForge：`createDocIngestTool` + `apply` require knowledge。
4. 默认 yml、`runtimeConfigById.knowledge.dbPath`、host 三路由、ASSEMBLY 测试夹具。
5. 工作台 Files | Knowledge。
6. 第 9 节验收测试全绿。
