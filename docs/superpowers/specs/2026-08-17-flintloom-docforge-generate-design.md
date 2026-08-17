# FlintLoom DocForge 生成切片设计

日期：2026-08-17  
状态：已复核  
产品：FlintLoom — A real agent. / 真正的 Agent。  
范围：总 spec 第三刀的 **`doc_generate` 块**。从工作区已有 markdown 写出 md / html / docx / pdf。挂在现有 `@flintloom/docforge` 的 `apply` 上，yml 不新加插件。禁止再往 `createRuntime` 里 `register`。本片不做 convert / edit / compare / summarize，不改 A2UI catalog，不改 Files preview `kind`。

## 1. 这是什么

Agent 先用 `fs`（或其它工具）把报告写成工作区 markdown，再调用 `doc_generate({ source, out })`。格式只看 `out` 的扩展名。磁盘上出现目标文件；Files 点开 pdf/docx 仍走现有 `doc_parse` 预览成 markdown，不内嵌 PDF 阅读器。

验收：工作区有 `hello.md`（含 `# Hello` 与中文「发展」）；调用工具写出 `hello.pdf` 后，`parse(hello.pdf)` 含这两段文字；`pnpm desktop` 文件树能点到该 pdf。`flint` 仍能跑完一轮。自动化测试不依赖真实 API key、不依赖本机 Word / Chrome / pandoc。

## 2. 复核后收紧的决策

| 点 | 决定 |
|---|---|
| 输入 | 只要工作区 markdown 路径。不要工具参数里的正文，不要「数据 → 文档」。 |
| 输出 | 四种：md / html / docx / pdf。 |
| 参数 | 必填 `source` + `out`。格式只看出参扩展名，不另传 `format`。 |
| 源类型 | 现有 `detectType(path, bytes)` 必须为 `md`（`.md` / `.markdown`）。docx 当 source → `bad source`（那是 convert）。禁止调用不存在的单参 `detectType(path)`。 |
| 出参扩展名 | 只认 `.md` `.html` `.docx` `.pdf`。先 `\`→`/` 再小写。`.htm` / `.markdown` / `.PDFX` 等 → `bad out`。 |
| 写盘 | 不 `mkdir`。父目录必须已存在且是目录。`out` 已存在且是文件则覆盖。 |
| 保真 | 标题、段落、列表、代码块、GFM 管道表。链接只留可见文字。粗体/斜体/行内代码压成纯文本。 |
| 跳过 | 图片、原始 HTML、脚注、分隔线。跳过不算失败。引用块压成普通段落（去掉 `>`）。嵌套列表压成一层。 |
| md→md | 不走 IR：去 BOM，若不以 `\n` 结尾则补一个 `\n`，原文拷贝（图片语法保留）。 |
| 引擎 | Node 纯库：html 自行拼文档；docx 用 npm `docx`；pdf 用 `pdfkit`。禁止 pandoc、Chrome、LibreOffice、系统字体。 |
| 中文 | 包内提交 `packages/docforge/fonts/NotoSansSC-Regular.otf` + `OFL.txt`（Noto CJK SubsetOTF SC，SIL OFL）。运行时不下载、不读 CDN。**PDF 必须 `pdfkit` 嵌入该文件，并用 `text()` 画字**（不要描成 path，否则 `parse()` 抽不出「发展」）。**docx 不嵌入 ODTTF**（实现成本高，mammoth 只看 XML 文本）；Run 的 `eastAsia`/`ascii` 字体名用 `Noto Sans SC`。 |
| 预览 | 不改 `FilePreview.kind`。生成的 pdf/docx 走现有 DocForge parse。 |
| 工具工厂 | `apps/host/src` 不得出现 `createDocGenerateTool`。host / desktop / loop / session 不得 import `generateDocument` / `parseBlocks`。 |
| 上限 | **先** `stat.size > 800000` → `too large`（不 `readFile`）。通过后再读盘；去 BOM 后 `.length > 200000` → `too large`。不静默截断。 |
| 空源 | 仍写出合法空文档（md 为单换行；html 为骨架；docx/pdf 为空正文）。 |
| 并发 | 两次 generate 不排队，后写覆盖先写（与 `fs` 相同）。 |
| 编码 | 源只按 UTF-8 读。GBK 不在本片修。 |

## 3. 非目标

- `doc_convert` / `doc_edit` / `doc_compare` / `doc_summarize`
- 工具参数里的 markdown 字符串；从 CSV/JSON「数据」生成文档
- A2UI 组件、信息图、Files 内嵌 PDF 阅读器、新 preview `kind`
- 图片嵌入、主题 CSS、可点击链接、页眉页脚、目录
- mkdir、OCR、云存储
- 自动把生成文件 `doc_ingest` 进知识库
- 引入 dataagent-v3 / deepseek-harness / Cordis
- 改 loop / session / 聊天气泡语义

## 4. 架构

```text
Agent
  doc_generate({ source, out })
        │
  resolveInside 两条路径
  hidden / source 存在且是文件 / detect md / out 扩展名 / 大小 / 父目录
        │
  @flintloom/docforge
        ├─ format md  → 拷 UTF-8（去 BOM，补换行）
        └─ html|docx|pdf → parseBlocks → 内存 Buffer（pdf 嵌包内字体）
        │
  完整 Buffer 成功后才 writeFile(out)；失败不改已有 out
        │
  tool/result: {"status":"ok","source","out","format"}
```

yml 仍是现在的 `docforge` 行，不插入新插件。`apply` 继续 `require("tools")` 与 `require("knowledge")`（ingest 需要 knowledge；generate 不用 kb）。去掉 `docforge` 行 → schema 无 probe/parse/ingest/**generate**。

根 package.json / host 依赖不必为 generate 新增包名；`packages/docforge/package.json` 增加 `docx`、`pdfkit`、`marked`（`gfm: true`，不把原始 HTML 当 DOM 执行）。字体是包内文件，不是 npm 依赖。

## 5. 组件

### 5.1 导出

```ts
export const GENERATE_MAX_CHARS = 200_000;
export const GENERATE_MAX_BYTES = 800_000;

export type GenerateFormat = "md" | "html" | "docx" | "pdf";

export type Block =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "code"; text: string }
  | { type: "table"; headers: string[]; rows: string[][] };

export function formatFromOutRelPath(relPath: string): GenerateFormat | undefined;
export function parseBlocks(markdown: string): Block[];
export async function buildDocument(
  format: GenerateFormat,
  markdown: string,
  opts?: { fontPath?: string },
): Promise<Buffer>;
export async function generateDocument(
  absSource: string,
  absOut: string,
): Promise<{ format: GenerateFormat }>;
```

`formatFromOutRelPath`：`relPath` 先 `\`→`/` 再小写；以 `.md` / `.html` / `.docx` / `.pdf` 结尾则返回对应 format，否则 `undefined`。不以 `.markdown` 或 `.htm` 当作合法 out。

`parseBlocks` 用 `marked.lexer`（`gfm: true`）。标题/段落/列表/围栏代码 + GFM 管道表。原始 HTML token 丢弃。图片 token 丢弃。链接取可见文字（无可见文字则用 URL 字符串，不发网络请求）。行内强调压平进 `text`。引用块变成 `paragraph`。`hr` / 脚注丢弃。嵌套列表的子项并入同一 `items` 数组（顺序深度优先）。表：表头为第一行，其后为 `rows`；短行右侧补 `""`。

`generateDocument` 只负责读源、在内存里 `buildDocument`、再一次 `writeFile`（覆盖）。**不做** hidden / 工作区闸门 / 父目录检查；那些在工具层。`formatFromOutRelPath(absOut)` 为空 → 抛 `Error("bad out")`。`stat.size > 800000` → `Error("too large")`（不读正文）。然后 `readFile`；`detectType(absSource, bytes)` 不是 `md` → `Error("bad source")`。去 BOM 后 `.length > 200000` → `Error("too large")`。`buildDocument` / I/O 失败 → `Error("unreadable")`。`readFile` 打到目录（EISDIR）也是 `unreadable`。

`buildDocument`：md 为去 BOM+补换行的 UTF-8；其余先 `parseBlocks`。pdf 默认 `fontPath` 为包内 `fonts/NotoSansSC-Regular.otf`（`import.meta.url`）。传入的 `fontPath` 不存在 → `unreadable`。html 不读字体。

字体路径：相对本包 `fonts/` 目录，经 `import.meta.url` 解析，不读 `process.cwd()`。

### 5.2 工具 `doc_generate`

```ts
{
  name: "doc_generate",
  description:
    "Write a workspace markdown file to md, html, docx, or pdf. Pass source and out; format is the out extension. Write the markdown with fs first. Do not use this to parse binaries.",
  parameters: {
    type: "object",
    properties: {
      source: { type: "string" },
      out: { type: "string" },
    },
    required: ["source", "out"],
  },
}
```

成功：

```ts
JSON.stringify({
  status: "ok",
  source: sourceRel, // 工作区相对路径，\ → /
  out: outRel,
  format,            // GenerateFormat
})
```

键顺序固定为 `status`、`source`、`out`、`format`。不把文件正文放进 result。

检查顺序（命中即返回，不再往后）：

1. `signal.aborted` → `aborted`
2. `source` 缺或非非空字符串 → `failed: missing source`
3. `out` 缺或非非空字符串 → `failed: missing out`
4. `resolveInside(source)`、`resolveInside(out)`（越界抛 `WorkspaceEscapeError`）
5. 请求 path 或 resolve 后的 rel 对 **任一条** 命中 `isHiddenRelPath` → `failed: hidden`
6. `formatFromOutRelPath(outRel)` 为空 → `failed: bad out`
7. `stat(source)`：ENOENT → `failed: not found`；不是文件 → `failed: not a file`
8. `source` 的 `stat.size > 800000` → `failed: too large`（此处不 `readFile`）
9. `dirname(absOut)`：不存在或不是目录 → `failed: missing parent`
10. `out` 已存在且不是文件 → `failed: not a file`
11. 调用 `generateDocument`（内部再 detect / 字符上限 / 内存构建 / writeFile）；抛错 → 若 `message` 是第 7 节理由表里的短英文则 `failed: <message>`，否则 `failed: unreadable`（不把系统路径或 stack 回给模型），**不写 / 不改** `out`
12. 成功 JSON

`source` 与 `out` 解析到同一路径且 format 为 `md`：允许（就地去 BOM / 补换行）。

### 5.3 html writer

写出 UTF-8 文件：

- `<!DOCTYPE html><html><head><meta charset="utf-8"><title>…</title></head><body>…</body></html>`
- `<title>`：第一个 heading 的 `text`，否则空
- 块：`h1`–`h6`、`p`、`ul`/`ol`+`li`、`pre`、`table`（第一行 `th`，其后 `td`）
- 所有文本 XML/HTML 转义（`&` `<` `>` `"`）
- 无 `<script>`、`<img>`、`<link>`、`<iframe>`、远程 CSS、内联事件属性
- 无主题：不写 `<style>`

### 5.4 docx / pdf writer

- docx：npm `docx`，标题用 Heading，列表用 bullet/number，代码用等宽段落，表用 Table。`TextRun` 字体 `{ ascii: "Noto Sans SC", eastAsia: "Noto Sans SC" }`。**不要**做 ODTTF 嵌入。
- pdf：`pdfkit`，A4，页边距 72，从左上 `text()` 流式排版。正文字号 12，`heading` 为 `24 - (level-1)*2`（下限 12）。`doc.font(fontPath)`；代码块也用同一字体。无页眉页脚、不 `font("Courier")`、不加载网络。

### 5.5 插件

现有 `apply` 增加一行：

```ts
ctx.effect(tools.register(createDocGenerateTool()));
```

放在 `createDocParseTool` 之后、`createDocIngestTool` 之前。`stop()` 后 schema 无 `doc_generate`。

### 5.6 Host / Desktop

不改 `files.ts` preview 分支。factory 扫描在现有 `createDocIngestTool` 旁增加 `createDocGenerateTool`。**不要**用正则禁止单词 `generate`（注释/别的标识会误伤）。

## 6. 数据流

1. Boot：yml 加载 docforge → 现有三工具 + `doc_generate`。
2. 模型 `tool_call` → path 闸门 + `tools/pre-execute` → 工具检查 → `generateDocument` → `writeFile`。
3. `tool/result` 为成功 JSON 或 `failed:` / `aborted`。不写 sidecar、不入库、不新开 session 事件类型。
4. 工作台文件树下次 list 看到 `out`；预览走现有 parse。聊天仍是 `tool/call` / `tool/result` 气泡。
5. CLI 可调同一工具。

## 7. 错误处理

| 情况 | 行为 |
|---|---|
| 缺 source / 缺 out | `failed: missing source` / `failed: missing out` |
| 越界 | `WorkspaceEscapeError`（与 fs） |
| hidden | `failed: hidden`（在 stat 之前，不泄露隐文件是否存在） |
| source 不存在 | `failed: not found` |
| source 或已存在的 out 不是文件 | `failed: not a file` |
| source 不是 md | `failed: bad source` |
| out 扩展名不合法 | `failed: bad out` |
| 父目录不存在或不是目录 | `failed: missing parent`（不 mkdir） |
| 字节或字符超限 | `failed: too large` |
| IR / 写库 / I/O 抛错 | `failed: unreadable`；已有 `out` 字节不变；本不存在则仍不存在 |
| abort | `aborted` |
| 图片等跳过 | 成功，不算 failed |
| yml 无 docforge | schema 无 `doc_generate` |
| 无 Bearer | 现有 401；本片不新开 HTTP |
| 生成失败 | turn 继续，不升成 `model/error` |
| 聊天失败 | 已写出的文件留在工作区 |

`failed:` 理由只允许：`missing source`、`missing out`、`hidden`、`not found`、`not a file`、`bad source`、`bad out`、`missing parent`、`too large`、`unreadable`。

## 8. 安全

- 只绑现有 host `127.0.0.1`；token 不进生成文件、session、SSE。
- 两条路径都 `resolveInside`；hidden 规则与 ingest 相同。
- html 转义，不执行源里的 HTML/脚本。
- pdf/docx 不加载网络资源；字体只来自包内文件。
- 链接不发请求。图片不读盘。
- 800_000 字节 / 200_000 字符上限。

## 9. 测试

夹具 `packages/docforge/tests/fixtures/hello.md`（可提交）：`# Hello`、一段含「发展」、一个 GFM 表、一行 `![skip](x.png)`。超长源在测试里临时写。

1. `out: a.md`：无 BOM、末尾换行、含 `![skip](x.png)`。
2. `out: a.html`：含 `Hello`、`发展`、charset；无 `<img>`、无 `<script>`；`&` 转义。
3. `out: a.docx` / `a.pdf`：现有 `parse()` 含 `Hello` 与 `发展`。
4. 覆盖：先写旧 `out`，再 generate，内容变成新的。
5. 父目录不存在 → `failed: missing parent`，该路径仍不存在。
6. source 为 sample.docx → `failed: bad source`；out `a.pptx` → `failed: bad out`。
7. 源 `.length > 200000` → `failed: too large`。`stat.size > 800000` 的文件不把正文当 UTF-8 解析。
8. hidden、`../outside`、缺 source 先于缺 out。
9. `buildDocument("pdf", "# Hello", { fontPath: 不存在的路径 })` 抛 `unreadable`。`generateDocument(目录路径, 已有 out)` 抛 `unreadable`，已有 `out` 字节不变。工具层把该错误映射为 `failed: unreadable`。
10. `apply` 后 schemas 含 `doc_generate`；yml 去掉 docforge 则不含。`stop()` 后不含。
11. host `src` 无 `createDocGenerateTool`。
12. 现有 probe/parse/ingest/预览/信息图/A2UI 测试保持绿。不打真实 DashScope。

## 10. 与总 spec / 前切片的关系

总 spec §10 `doc_generate` 本片落地为：**工作区 markdown 路径 → md/html/docx/pdf**。「数据 → 文档」仍留后续。`doc_probe` / `doc_parse` / `doc_ingest` 不变。parse 切片禁止的 pandoc/OCR/浏览器在本片同样禁止。

预览仍是 [文件预览设计](2026-08-17-flintloom-files-preview-design.md) 的 DocForge 分支。信息图 / A2UI 本片不改。

其余 convert/edit/compare/summarize、通道、`flint plugin add` 不在本片。

## 11. 实现顺序（本刀内）

1. `parseBlocks` + `formatFromOutRelPath` + md/html `buildDocument`（无字体）。
2. 包内字体 + docx/pdf writer；`generateDocument`。
3. `createDocGenerateTool` + `apply` 登记；夹具与工具测试。
4. host factory 扫描加一条；yml 去掉 docforge 则无 `doc_generate`。
5. 第 9 节验收测试全绿。
