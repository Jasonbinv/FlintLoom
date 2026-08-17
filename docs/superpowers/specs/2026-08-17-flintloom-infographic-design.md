# FlintLoom 信息图（盒线核心）设计

日期：2026-08-17  
状态：待审阅  
产品：FlintLoom — A real agent. / 真正的 Agent。  
范围：总 spec 第三刀的 **信息图块**。插件 `@flintloom/infographic`、工具 `infographic_get` / `infographic_patch`、工作区 `*.infographic.json`、Files 预览出消毒 SVG。从出生就是插件：禁止再往 `createRuntime` 里 `register`。本片 **不改** A2UI catalog。

## 1. 这是什么

信息图的真源是工作区里的 `*.infographic.json`（盒线关系图：`nodes` + `edges`）。Agent 用 `infographic_get` 读文档、用 `infographic_patch` 按 id 打补丁（缺文件时带 `addNode` 可建档）。工作台 Files 点该文件时，`GET /v1/files/preview` 返回 `{ kind: "svg", text }`，预览区用 `<img>` 显示图，不附 JSON 源码。

渲染器是包内纯函数 `renderSvg`：只产出闭集 SVG 元素，标签 XML 转义，无远程 URL。host 预览与以后的 A2UI Infographic 组件共用这一函数。本片桌面不 import 该包，只显示 host 给的 SVG。

验收：工作区放一份两节点一边的 `flow.infographic.json`，`pnpm desktop` 点它能看到节点文字；Agent（或测试里直接调工具）`patch` 改 label 后再预览文字已变；`notes.json` 仍是文本预览。`flint` 仍能跑完一轮。自动化测试不依赖真实 API key。

## 2. 复核后收紧的决策

| 点 | 决定 |
|---|---|
| 切法 | 独立 `@flintloom/infographic`。校验 + get/patch + `renderSvg`。不改 A2UI catalog。 |
| 形态 | 只做盒线关系图。海报指标卡、步骤时间线以后可加 kind，不进本片。 |
| 预览 | 只渲染消毒 SVG。不上图下 JSON。 |
| 建档 | 路径必须是 `*.infographic.json`。文件不存在时，ops 含至少一次 `addNode` 才从空文档建档。不 `mkdir`。 |
| patch | 操作列表：`addNode` / `updateNode` / `removeNode` / `addEdge` / `removeEdge`。不是 RFC 6902，不是整文件替换。 |
| 边的身份 | `(from, to)`。重复 `addEdge` 失败。`removeNode` 删除所有以该 id 为 from 或 to 的边。 |
| 预览与插件 | host `files.ts` **可以** import `parseDocument` / `renderSvg`（与 DocForge 预览相同）。yml 去掉 infographic → schema 无两工具；`*.infographic.json` **仍**出 SVG。 |
| 工具工厂 | `apps/host/src` 不得出现 `createInfographicGetTool` / `createInfographicPatchTool`。 |
| loop / session | 不改。不 import `@flintloom/infographic`。不暂停 turn。 |
| 上限 | UTF-8 **字节**数 > 65536（读入或写出）→ 失败。 |
| 远程 | 任意字符串含 `http://` 或 `https://` → 整份非法（与 A2UI 相同）。 |
| 消毒 | 构造时只 emit `svg` / `rect` / `line` / `polygon` / `text`。桌面用 `data:image/svg+xml` 的 `<img>`，不用 `dangerouslySetInnerHTML`。 |
| 并发 | 两个 patch 不排队，后写覆盖先写（与 `fs` 相同）。 |

相对路径做后缀判断时先把 `\` 换成 `/` 再 **小写**，以 `.infographic.json` 结尾（故 `Foo.Infographic.JSON` 走信息图，`notes.json` 不走）。

## 3. 非目标

- A2UI `Infographic` 组件、table、chart
- 海报 / 时间线 kind、颜色、节点形状、自由画布拖拽
- `doc_convert` / `doc_generate` / `doc_edit` / `doc_compare` / `doc_summarize`
- 把 HTTP 路由做成插件；新 preview 路由
- `flint plugin add`、MCP、skill、通道
- 引入 dataagent-v3 / deepseek-harness / Cordis、官方 infographic 运行时
- 改知识库语义；改聊天气泡；改 A2UI wait

## 4. 架构

```text
flintloom.yml  … → docforge → infographic → a2ui → loop

@flintloom/infographic
  provide("infographic")     parseDocument / applyOps / renderSvg
  register infographic_get
  register infographic_patch

工具                         GET /v1/files/preview
  resolveInside                 后缀 .infographic.json
  读/写 JSON                    排在 DocForge 与 .json 文本之前
        │                              │
        ▼                              ▼
   parseDocument / applyOps      parseDocument + renderSvg
                                      │
                                      ▼
                               { kind: "svg", text: "<svg …>" }
                                      │
                               FilePane <img data URL>
```

yml 在 `docforge` 与 `a2ui` 之间插入：

```yaml
  - id: infographic
    name: "@flintloom/infographic"
```

`apply` **必须** `require("tools")`。不 `require` knowledge / docforge / a2ui / loop。去掉 infographic 行 → 启动成功。根 `package.json` 把 `@flintloom/infographic` 列为 `devDependencies`。`createRuntime` 不为 infographic 写 `runtimeConfigById`。

信息图插件在依赖上只需要 `tools`；放在 docforge 之后只是文档分组。yml 无 docforge、有 infographic → 仍应启动。

## 5. 组件

### 5.1 文档

```ts
type InfographicNode = {
  id: string;
  label: string;
  x: number;
  y: number;
};

type InfographicEdge = {
  from: string;
  to: string;
  label?: string;
};

type InfographicDocument = {
  nodes: InfographicNode[];
  edges: InfographicEdge[];
};
```

只允许这两个顶层键。节点/边对象不得有未列字段。`id` / `from` / `to` 匹配 `^[A-Za-z0-9_-]+$` 且非空。`id` 在 `nodes` 内唯一。`x` / `y` 为有限 JSON number（拒绝 `NaN` / `Infinity`）。`label` 为字符串；边的 `label` 省略则不画边字。每条边的 `(from, to)` 唯一；`from` / `to` 必须引用已有 node id。自环允许。

`parseDocument(raw: string): InfographicDocument` 失败抛 `Error`，`message` 仅为短英文：`bad json` / `too large` / `bad document` / `bad id` / `duplicate id` / `unknown node` / `duplicate edge` / `remote url`。

### 5.2 `applyOps`

```ts
type InfographicOp =
  | { op: "addNode"; id: string; label: string; x: number; y: number }
  | { op: "updateNode"; id: string; label?: string; x?: number; y?: number }
  | { op: "removeNode"; id: string }
  | { op: "addEdge"; from: string; to: string; label?: string }
  | { op: "removeEdge"; from: string; to: string };

function applyOps(doc: InfographicDocument, ops: unknown): InfographicDocument;
```

整批应用，失败则调用方看到的磁盘文件不变。`ops` 不是长度 ≥ 1 的数组 → `empty ops`。未知 `op` → `bad op`。`updateNode` 必须至少带 `label` / `x` / `y` 之一，否则 `bad op`。应用后再跑与 `parseDocument` 相同的文档规则（含 64KiB：按将要写出的 UTF-8 计）。

写出：`JSON.stringify(doc, null, 2) + "\n"`。

### 5.3 `renderSvg`

纯函数，无 `fs`、无网络。节点画成固定 `120×40` 的 `rect`（左上角为 `x,y`）；边为中心到中心的 `line`，终点一个小 `polygon` 箭头；`text` 为 XML 转义后的 label。viewBox 为所有节点盒加 `24` 边距；没有节点时 viewBox `0 0 200 80`。不输出 `href`、事件属性、`foreignObject`、`<script>`、`<style>`、`<use>`。

「消毒」= 闭集构造 + XML 转义，不引入独立 sanitizer 库。

### 5.4 工具

两者都先 `resolveInside`。`signal.aborted` → `aborted`。隐藏路径 → `failed: hidden`（不读盘正文）。相对路径（规范化后小写）不以 `.infographic.json` 结尾 → `failed: bad path`。

`infographic_get({ path })`

| 情况 | 返回 |
|---|---|
| 成功 | `JSON.stringify(document)`（紧凑，无 SVG） |
| 不存在 | `failed: not found` |
| 目录 | `failed: not a file` |
| 校验失败 | `failed: <reason>` |

`infographic_patch({ path, ops })`

| 情况 | 返回 |
|---|---|
| 成功 | `JSON.stringify({ status: "ok", path, nodes, edges })`（后两项为数量） |
| 不存在且 ops 含 `addNode` | 从 `{ nodes: [], edges: [] }` 应用后写入 |
| 不存在且无 `addNode` | `failed: not found` |
| 父目录不存在 | `failed: not found` |
| 非法 ops / 校验失败 | `failed: <reason>`，**不写** |
| 缺 `path` / `ops` | `failed: missing path` 或 `failed: empty ops` |

越界仍抛 `WorkspaceEscapeError`。

### 5.5 插件

```ts
const plugin: FlintPlugin = {
  name: "@flintloom/infographic",
  apply(ctx) {
    const tools = ctx.require<ToolRegistry>("tools");
    ctx.provide("infographic", { parseDocument, applyOps, renderSvg });
    ctx.effect(tools.register(createInfographicGetTool()));
    ctx.effect(tools.register(createInfographicPatchTool()));
  },
};
```

`stop()` 后 schema 无这两个工具。host 预览 **不** 走 `ctx.get("infographic")`，直接 import 纯函数。

### 5.6 Host 预览

`FilePreview.kind` 增加 `"svg"`。`previewWorkspaceFile` 在 DocForge 分支与 `isTextPreviewCandidate` **之前**：若 relPath 小写以 `.infographic.json` 结尾，则读入字节（**不用** 200_000 字符文本截断）；长度 > 65536 → `{ kind: "failed", text: "failed: too large" }`；否则 UTF-8 → `parseDocument` + `renderSvg`。失败 → `{ kind: "failed", text: "failed: <reason>" }`。隐藏 / 目录 / 不存在语义与今日 files 预览相同。

普通 `*.json` 仍 `kind: "text"`。

factory 扫描：禁止 `createInfographicGetTool`、`createInfographicPatchTool`；**不要**禁止 `@flintloom/infographic`。

### 5.7 Desktop

`apps/desktop/src/files.ts` 的 `FilePreview.kind` 同步加 `"svg"`。FilePane：`kind === "svg"` 时 `<img alt={path} src={"data:image/svg+xml;charset=utf-8," + encodeURIComponent(text)} />`；`markdown` / `text` / `failed` 仍 `<pre>`。点文件仍插入相对路径。不改 Knowledge、不改聊天。

## 6. 数据流

1. Boot：yml 加载 infographic → `provide` + 登记两工具。
2. Agent `infographic_get` → 读盘 → parse → `tool/result` 为文档 JSON。
3. Agent `infographic_patch` → parse 或空文档 → `applyOps` → `writeFile`（失败则已读的旧文件仍在）→ 计数 JSON。
4. 工作台点文件 → `GET /v1/files/preview` → parse + `renderSvg` → FilePane `<img>`。
5. CLI 可调工具，不渲染、不暂停。

## 7. 错误处理

| 情况 | 工具 | HTTP 预览 / UI |
|---|---|---|
| 无 Bearer | — | 401 |
| 越界 | 抛 `WorkspaceEscapeError` | 400 |
| 隐藏 | `failed: hidden` | 200 `kind: failed` |
| 不是 `*.infographic.json` | `failed: bad path` | 走原文本预览 |
| get 不存在 | `failed: not found` | 404 |
| patch 不存在且无 addNode | `failed: not found` | — |
| 父目录不存在 | `failed: not found` | — |
| 目录 | `failed: not a file` | 200 `kind: failed` |
| 非法 JSON / 超限 / 坏 id / 坏边 / `http(s)` | `failed: …`，文件不动 | 200 `kind: failed` |
| abort | `aborted` | 预览 abort 与今日相同 |
| yml 无 infographic | schema 无两工具 | 预览仍出 SVG |
| 预览失败 | — | 聊天不受影响 |
| 聊天失败 | — | 预览不受影响 |

## 8. 安全

- 只绑 `127.0.0.1`；token 仍只在 Node 代理。
- 读写前 `resolveInside`；隐藏规则与文件树相同。
- 渲染不加载网络资源；字符串禁 `http://` / `https://`。
- SVG 闭集构造；桌面 `<img>` 不执行 SVG 脚本。
- API 密钥不进 session、SSE、yml、信息图 JSON。
- 64KiB 上限。

## 9. 测试

全部不依赖真实 API key。

1. `parseDocument`：合法两节点一边通过；缺 id / 重复 id / 悬空边 / `https://` / 超 64KiB 失败。
2. `applyOps`：`addNode` 建档；`updateNode` 改 label；`removeNode` 带走边；非法边不改变调用方传入的意图——工具层断言磁盘不变。
3. `renderSvg`：含节点 label；`&` 转成 `&amp;`；无 `href`、无 `<script>`。
4. `infographic_get` / `patch`：成功形状如上；缺 path / `bad path` / abort；越界抛 `WorkspaceEscapeError`。
5. 插件 `stop()` 后 schema 无这两个工具。
6. HTTP 预览：`flow.infographic.json` → 200 `kind:"svg"` 且 `text` 含 `<svg`；坏 JSON → `kind:"failed"`；普通 `notes.json` 仍 `kind:"text"`。
7. yml 去掉 infographic：schema 无工具；同一 `*.infographic.json` 预览仍 `kind:"svg"`。
8. 桌面：mock `kind:"svg"` → 出现 `img`，查询不到文档 JSON 原文；Files | Knowledge、插路径旧用例仍绿。
9. host `src` 无 `createInfographicGetTool` / `createInfographicPatchTool`。
10. 现有 `pnpm test`（知识库 / A2UI / 预览 / loop）保持绿。

## 10. 与总 spec / 前切片的关系

总 spec §8 的 `infographic_get` / `infographic_patch`、`*.infographic.json`、禁止远程资源、SVG 消毒、超大拒绝，本片落地。工作台预览走现有 `GET /v1/files/preview` 的新 `kind`，不新开路由。A2UI infographic 组件仍留后续：本片把 `renderSvg` 做成无 Node API 的纯函数，供那一刀 import。

其余 DocForge 工具、通道、`flint plugin add` 不在本片。

新 Loom 包必须 `apply`；禁止 `createRuntime` 里 `register`。

## 11. 实现顺序（本刀内）

1. `@flintloom/infographic`：类型、`parseDocument` / `applyOps` / `renderSvg`（无 host）。
2. 插件 + `infographic_get` / `infographic_patch`。
3. 默认 yml、ASSEMBLY、host 预览 `kind: "svg"`、factory 扫描。
4. FilePane `<img>`。
5. 第 9 节验收测试全绿。
