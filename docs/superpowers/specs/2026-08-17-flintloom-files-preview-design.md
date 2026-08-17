# FlintLoom 文件树与预览设计

日期：2026-08-17  
状态：已审阅  
产品：FlintLoom — A real agent. / 真正的 Agent。  
范围：总 spec 第二刀的 **预览块**。不做上传、知识库、`doc_ingest`、Electron、A2UI、信息图渲染器。

## 1. 这是什么

在现有浏览器工作台右侧增加文件树和预览：点工作区内的文件，看到文档的 DocForge markdown 或源码文本，并把相对路径插入聊天输入框（不自动发送）。

验收：`pnpm desktop` 打开 `http://127.0.0.1:5173`，右侧能列出工作区（不含 `node_modules` 等），点 `README.md` 预览含标题文本，输入框出现 `README.md`。自动化测试不依赖真实 API key。

## 2. 复核后收紧的决策

相对初稿：

| 点 | 决定 |
|---|---|
| 路由顺序 | 先匹配 `GET /v1/files/preview`，再匹配 `GET /v1/files`，避免被前缀吃掉。 |
| 列表默认 | `path` 缺省或空 = `.`（工作区根）。只列**一层**，点目录再请求该层。 |
| 隐藏规则 | **basename** 命中下列任一则既不列出、也不可预览：`.git`、`node_modules`、`dist`、`credentials`；或名称匹配 `^\.env(?!\.example$)`（`.env`、`.env.local`、`.env.production` 全藏，**`.env.example` 仍可见**）；或 `path.extname(basename) === ".env"`（如 `secret.env`）。不要用 `extname(".env")` 当「扩展名是 env」——Node 对这个名字返回空串，必须靠 basename 规则覆盖。 |
| 直拼隐藏路径 | `path` 的**任意一段** basename 命中隐藏规则（含 `docs/node_modules/x`）→ list 与 preview 都不读盘：preview HTTP 200 `kind: failed` `text: failed: hidden`；list HTTP 404（与不存在同形）。 |
| `.md` | 走 DocForge parse（去 BOM 的原文），不当成「源码旁路」。 |
| 源码/纯文本 | 扩展名在白名单内，**或没有扩展名**（`Makefile`、`.gitignore`、`LICENSE`），且文件无 NUL 字节 → UTF-8 原文，截断 200_000，标记与 `fs` 相同。无扩展名必须排在隐藏规则之后，以免把 `.env` 当文本读出。 |
| 目录预览 | `GET preview` 若目标是目录 → `kind: "failed"`, `text: "failed: not a file"`，HTTP 200。 |
| list 打到文件 | `GET /v1/files?path=README.md` 且目标是文件 → HTTP 400，body `failed: not a directory`。 |
| 点文件 | 预览 + 把相对路径（正斜杠）插入输入框；已有内容则先加一个空格再追加。若最后一个空白分隔 token **已经等于**该路径，不再重复插入。不发送。 |
| 根 path | list/preview JSON 与请求里，工作区根一律 `"."`，不要 `""`。子路径 `docs/a.md`，不要 `./docs/a.md`。 |
| 点目录 | 只展开/收起，不改输入框、不预览。 |
| 预览 UI | `<pre>` 展示 `text`，本切片不引入 markdown 渲染库。 |
| 代理 | Vite 已转发带 query 的 `req.url`；本切片不改代理语义。 |
| 越界 | `WorkspaceEscapeError` → HTTP 400，body 为错误信息（与现有 host 文本错误一致）。 |
| 不存在 | HTTP 404。 |

## 3. 非目标

- 拖放/回形针上传
- 个人知识库、`doc_ingest`
- Electron、工作区选择器
- A2UI、信息图专用渲染、PDF 画布
- 完整 `.gitignore` 引擎
- 渲染 markdown 为 HTML
- 修改 `runTurn`、改 7331 CORS、把 token 送进页面

## 4. 架构

```text
左：现有聊天          右上：文件树
                      右下：预览 <pre>
        │
        GET /v1/files?path=
        GET /v1/files/preview?path=
        （5173 代理补 Bearer）
        ▼
Flint host  127.0.0.1:7331
        resolveInside → list 或 preview
```

`preview` 决策（按序，命中即停）：

1. `path` 缺省/空 → HTTP 400
2. 越界 → HTTP 400
3. 任一段 basename 命中隐藏规则 → 200 `{ kind: "failed", text: "failed: hidden" }`
4. 不存在 → HTTP 404
5. 目标是目录 → 200 `{ kind: "failed", text: "failed: not a file" }`
6. `detectType` ∈ md/html/pdf/docx/pptx/xlsx → `parse`；返回以 `failed:` 开头则 `kind: "failed"`，否则 `kind: "markdown"`
7. 扩展名在文本白名单，**或扩展名为空**，且无 NUL → `kind: "text"`
8. 否则 200 `{ kind: "failed", text: "failed: unsupported type" }`

## 5. 组件

### 5.1 Host

`apps/host/src/server.ts` 增加两路由。可抽 `apps/host/src/files.ts` 以免 `server.ts` 再膨胀。

`GET /v1/files?path=`

```json
{ "path": "docs", "entries": [ { "name": "a.md", "type": "file" }, { "name": "sub", "type": "dir" } ] }
```

entries 按名称排序，目录与文件混排即可（locale `en`）。不含隐藏名。

`GET /v1/files/preview?path=`

```json
{ "path": "README.md", "kind": "markdown" | "text" | "failed", "text": "..." }
```

缺 `path`：400。

文本白名单扩展名（小写）：

`.ts` `.tsx` `.js` `.jsx` `.mjs` `.cjs` `.json` `.yml` `.yaml` `.css` `.txt` `.xml` `.svg` `.sh` `.bash` `.ps1` `.bat` `.toml` `.sql` `.py` `.rs` `.go` `.java` `.kt` `.mdx` `.map` `.lock`

不含 `.md`（走 DocForge）。不含 `.html`/`.pdf`/office（走 DocForge）。

### 5.2 Desktop

- `apps/desktop/src/files.ts`：`fetchFiles` / `fetchPreview`
- `apps/desktop/src/FilePane.tsx`：树 + 预览
- `App.tsx`：左右分栏；把 `setInput` 传给 FilePane
- `app.css`：分栏、树、预览滚动

树状态：`expanded` 集合 + 每层缓存的 entries。根请求 `path=.`。子项完整路径：根下文件为 `name`；子目录内为 `父path/name`（父为 `.` 时不要拼成 `./name`）。

点文件时的路径用拼好的相对路径（`/` 分隔）。列表/预览失败时，树或预览区文案 `host unreachable`（与聊天同一英文）。

### 5.3 测试

- host：临时工作区含 `README.md`、`.env`、`.env.example`、`.env.production`、`secret.env`、`Makefile`、`node_modules/pkg/x.js`、`src/a.ts`
  - list `.` 不含 `node_modules`、`.env`、`.env.production`、`secret.env`；含 `README.md`、`src`、`.env.example`、`Makefile`
  - preview `README.md` 的 text 含标题，`kind` 为 `markdown`
  - preview `src/a.ts` 与 `Makefile`：`kind` `text`，含源码
  - preview `.env`、`.env.production`、`secret.env` → `failed: hidden`
  - preview `.env.example` → 文本或 markdown，**不得** hidden
  - list `node_modules` → 404
  - list `README.md` → 400 `failed: not a directory`
  - `path=../x` → 400
- App：mock fetch，夹具 list + preview，断言出现文件名与预览文本；点击后 input 含路径；再点同一文件 input 不出现两份路径。不启真实 host。

## 6. 数据流

1. 页面加载：与现在一样 `GET /v1/models`、`GET /v1/sessions/:id`；并行 `GET /v1/files`
2. 点目录：`GET /v1/files?path=<dir>`
3. 点文件：`GET /v1/files/preview?path=<file>`；更新预览；插入 input
4. 换文件时 abort 上一次 preview 的 `AbortSignal`
5. list/preview 网络失败：预览区显示 `host unreachable`（与聊天同一英文，便于测）

## 7. 错误处理

| 情况 | HTTP | body |
|---|---|---|
| 无 Bearer | 401 | 现有空/文本 |
| 越界 | 400 | `Path escapes workspace: …` |
| 路径不存在或 list 隐藏目录 | 404 | 现有 `send(res, 404)` |
| list 打到文件 | 400 | `failed: not a directory` |
| preview 缺 path | 400 | （无 JSON） |
| 隐藏文件预览 | 200 | JSON `kind: failed`, `text: failed: hidden` |
| parse 失败 | 200 | JSON `kind: failed`, `text` 为 docforge 的 `failed: …` |
| 不支持类型 | 200 | JSON `kind: failed`, `text: failed: unsupported type` |

聊天失败不影响文件树；文件树失败不影响已有气泡。

## 8. 安全

- 只绑 127.0.0.1；token 仍只在 Node 代理。
- 路径 `resolveInside`。
- `.env*`（除 `.env.example`）、`credentials`、`.git`、`node_modules`、`dist` 不进树、不进预览。
- 判断隐藏用 basename / 路径段，**禁止**只靠 `path.extname(".env")`。
- 预览截断 200_000。
- 不把 API key 写入 list/preview JSON。

## 9. 与总 spec / 前切片的关系

总 spec `GET /v1/files` 与 `GET /v1/files/preview` 本切片落地；preview 调用已有 `@flintloom/docforge` 的 `parse`/`detectType`，不另开解析流水线。信息图渲染器仍属第三刀。知识库见 [知识库设计](2026-08-17-flintloom-knowledge-design.md)。
