# FlintLoom DocForge 转换切片设计

日期：2026-08-18  
状态：已审阅草稿  
产品：FlintLoom — A real agent. / 真正的 Agent。  
范围：总 spec 第三刀的 **`doc_convert` 块**。工作区已有文档 → md / html / docx / pdf。挂在现有 `@flintloom/docforge` 的 `apply` 上，yml 不新加插件。禁止再往 `createRuntime` 里 `register`。本片不做 edit / compare / summarize，不写 xlsx/pptx，不改 A2UI catalog，不改 Files preview `kind`。

## 1. 这是什么

Agent 调用 `doc_convert({ source, out })`，把能 `doc_parse` 的文件转成 generate 那四种目标格式并落盘。格式只看 `out` 的扩展名。成功 JSON 带固定 `loss` 短句，说明保真损失。parse 失败则原样 `failed:`，不写 `out`。

验收：夹具写出的 `sample.docx` → `out.md` 后正文含 `Hello`；`hello.md`（含「发展」）→ `out.pdf` 后 `parse(out.pdf)` 含 Hello 与「发展」；`empty.pdf` 转换失败且目标文件不出现。`flint` 仍能跑完一轮。自动化测试不依赖真实 API key、不依赖本机 Word / Chrome / pandoc。

## 2. 复核后收紧的决策

| 点 | 决定 |
|---|---|
| 源 | `detectType(path, bytes)` 两参数，结果为 md / html / pdf / docx / pptx / xlsx。禁止单参 `detectType(path)`。其余 → `failed: unsupported type`。 |
| 目标 | 只认 `.md` `.html` `.docx` `.pdf`（与 generate 相同：先 `\`→`/` 再小写）。`.xlsx` / `.pptx` / `.htm` / `.markdown` → `bad out`。 |
| 参数 | 必填 `source` + `out`。不另传 `format`。 |
| md 源 | 允许。内部仍 `parse` 再 `buildDocument`。不要求模型改走 `doc_generate`。 |
| md→md | `loss` 为 `none`；`buildDocument("md")` 去 BOM、补末尾换行；图片语法保留。 |
| 空 md / 空 PDF | 走 parse 的 `failed: empty text`，**不**像 generate 那样写出空文档。 |
| 流水线 | `detectType` → `parse(source)` → markdown → `buildDocument` → 一次 `writeFile`。不落中间 `.md`。不新写 pdf/docx writer。 |
| 保真说明 | 成功 JSON 的 `loss` 按**源类型**查表（md→md 除外）。html/docx/xlsx → html/docx/pdf 仍只用源类型那一行，不叠第二句。不跑 diff、不调模型。 |
| parse 失败 | 工具**原样**返回 `failed: …`，不写 `out`。不发明新失败词（闸门词除外）。 |
| 写盘 | 不 `mkdir`。父目录必须已存在且是目录。`out` 已存在且是文件则覆盖。`source` 与 `out` 同一路径允许（就地覆盖）。 |
| 上限 | 复用 `GENERATE_MAX_BYTES`（800_000）与 `GENERATE_MAX_CHARS`（200_000）。工具层先 `stat.size > GENERATE_MAX_BYTES` → `too large`（不 `readFile` / 不 `parse`）。parse 成功后 markdown `.length > GENERATE_MAX_CHARS` → `too large`，不写。parse 截断标记会让长度超限，故**不得**把截断 markdown 交给 `buildDocument`。 |
| 预览 | 不改 `FilePreview.kind`。 |
| 工具工厂 | `apps/host/src` 不得出现 `createDocConvertTool`。host / desktop / loop / session 不得 import `convertDocument` / `lossForConvert`。 |
| 并发 | 两次 convert 不排队，后写覆盖先写。 |

## 3. 非目标

- 写出 `.xlsx` / `.pptx` / `.htm`
- `doc_edit` / `doc_compare` / `doc_summarize`
- A2UI、信息图、Files 内嵌 PDF 阅读器、新 preview `kind`
- mkdir、OCR、中间临时 markdown 文件
- 自动 `doc_ingest`
- 引入 dataagent-v3 / deepseek-harness / Cordis
- 改 loop / session / 聊天气泡语义

## 4. 架构

```text
Agent
  doc_convert({ source, out })
        │
  resolveInside 两条路径
  hidden / source 存在且是文件 / out 扩展名 / 大小 / 父目录
        │
  detectType(source, bytes)     // 必须两参数
        ├─ 非六种可 parse 类型 → failed: unsupported type（不写 out）
        └─ parse(source)
              ├─ 返回 failed: … → 原样返回，不写 out
              └─ markdown（.length > GENERATE_MAX_CHARS → too large）
                    │
              buildDocument(formatFromOutRelPath(out)) → Buffer → writeFile
                    │
              tool/result JSON + 固定 loss
```

yml 仍是现在的 `docforge` 行，不插入新插件。`apply` 在 `createDocParseTool` 之后、`createDocGenerateTool` 之前登记 `createDocConvertTool`。去掉 `docforge` 行 → schema 无 probe/parse/**convert**/generate/ingest。

不新增 npm 依赖；复用现有 `parse`、`buildDocument`、`formatFromOutRelPath`、`GENERATE_MAX_BYTES` / `GENERATE_MAX_CHARS`、包内 CJK 字体。写出规则与 `doc_generate` 相同：不 mkdir、覆盖已有文件、PDF 嵌包内字体、docx 不嵌 ODTTF。

## 5. 组件

### 5.1 导出

```ts
export type ConvertFrom = "md" | "html" | "pdf" | "docx" | "pptx" | "xlsx";

export function lossForConvert(from: ConvertFrom, format: GenerateFormat): string;

export async function convertDocument(
  absSource: string,
  absOut: string,
): Promise<{ from: ConvertFrom; format: GenerateFormat; loss: string }>;
```

`lossForConvert`（固定英文，按下表；不跑 diff、不调模型）：

| `from` | `format` | 返回值 |
|---|---|---|
| `md` | `md` | `none` |
| `md` | html / docx / pdf | `images skipped; emphasis flattened` |
| `html` | 任一合法目标 | `scripts and layout discarded` |
| `pdf` | 任一合法目标 | `images and layout discarded; text only` |
| `docx` | 任一合法目标 | `images and complex formatting discarded` |
| `pptx` | 任一合法目标 | `notes and images discarded; slide text only` |
| `xlsx` | 任一合法目标 | `formulas charts and formatting discarded; tables as text` |

`convertDocument` **不做** hidden / 工作区闸门 / 父目录检查；那些在工具层。步骤：

1. `formatFromOutRelPath(absOut)` 为空 → 抛 `Error("bad out")`。
2. `stat.size > GENERATE_MAX_BYTES` → 抛 `Error("too large")`（不读正文）。
3. `readFile` 得 bytes，再 `detectType(absSource, bytes)`（必须两参数）。结果不是 `ConvertFrom` → 抛 `Error("unsupported type")`。`from` 取该返回值，不按扩展名猜。
4. `parse(absSource)`：若以 `failed: ` 开头，抛 `Error` 且 `message` 为去掉前缀后的短英文（`empty text` / `encrypted` / `unsupported type` / `not found` / `unreadable`）。允许 parse 再读一次文件。
5. markdown `.length > GENERATE_MAX_CHARS` → 抛 `Error("too large")`（含 parse 截断标记导致超长）。
6. `buildDocument(format, markdown)`；失败 → `Error("unreadable")`。
7. 完整 Buffer 成功后再 `writeFile(absOut)`（覆盖）。I/O 失败 → `Error("unreadable")`。`readFile` 打到目录（EISDIR）也是 `unreadable`。
8. 返回 `{ from, format, loss: lossForConvert(from, format) }`。

### 5.2 工具 `doc_convert`

```ts
{
  name: "doc_convert",
  description:
    "Convert a workspace document (md, html, pdf, docx, pptx, or xlsx) to md, html, docx, or pdf. Pass source and out; format is the out extension. pptx and xlsx cannot be out. Do not use this to generate from scratch; write markdown first or use doc_generate for md sources if you prefer.",
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
  from,              // ConvertFrom
  format,            // GenerateFormat
  loss,
})
```

键顺序固定为 `status`、`source`、`out`、`from`、`format`、`loss`。不把文件正文放进 result。

检查顺序（命中即返回，不再往后）：

1. `signal.aborted` → `aborted`
2. `source` 缺或非非空字符串 → `failed: missing source`
3. `out` 缺或非非空字符串 → `failed: missing out`
4. `resolveInside(source)`、`resolveInside(out)`（越界抛 `WorkspaceEscapeError`）
5. 请求 path 或 resolve 后的 rel 对 **任一条** 命中 `isHiddenRelPath` → `failed: hidden`（在 stat 之前，不泄露隐文件是否存在）
6. `formatFromOutRelPath(outRel)` 为空 → `failed: bad out`
7. `stat(source)`：ENOENT → `failed: not found`；不是文件 → `failed: not a file`
8. `source` 的 `stat.size > GENERATE_MAX_BYTES` → `failed: too large`（此处不 `readFile`）
9. `dirname(absOut)`：不存在或不是目录 → `failed: missing parent`
10. `out` 已存在且不是文件 → `failed: not a file`
11. 调用 `convertDocument`（内部再 detect / parse / 字符上限 / 内存构建 / writeFile）；抛错 → 若 `message` 是第 7 节理由表里的短英文则 `failed: <message>`，否则 `failed: unreadable`（不把系统路径或 stack 回给模型），**不写 / 不改** `out`
12. 成功 JSON

parse 失败由 `convertDocument` 抛出后变成 `failed: empty text` 等，与 `doc_parse` 同一套理由词。

`failFromError` 在 generate 现有集合上再允许 parse 的 `empty text` / `encrypted` / `unsupported type`（generate 不会抛这三项，扩展集合不改变 generate 行为）。

### 5.3 插件

现有 `apply` 增加一行，放在 `createDocParseTool` 之后、`createDocGenerateTool` 之前：

```ts
ctx.effect(tools.register(createDocParseTool()));
ctx.effect(tools.register(createDocConvertTool()));
ctx.effect(tools.register(createDocGenerateTool()));
ctx.effect(tools.register(createDocIngestTool(kb)));
```

`stop()` 后 schema 无 `doc_convert`。

### 5.4 Host / Desktop

不改 `files.ts` preview 分支。factory 扫描在现有 `createDocGenerateTool` 旁增加 `createDocConvertTool`。**不要**用正则禁止单词 `convert`（注释/别的标识会误伤）。`packages/loop/src`、`packages/session/src`、`apps/desktop/src` 不得出现 `convertDocument` / `lossForConvert`。

## 6. 数据流

1. Boot：yml 加载 docforge → 现有工具 + `doc_convert`。
2. 模型 `tool_call` → path 闸门 + `tools/pre-execute` → 工具检查 → `convertDocument` → `writeFile`。
3. `tool/result` 为成功 JSON 或 `failed:` / `aborted`。不写 sidecar、不入库、不新开 session 事件类型。
4. 工作台文件树下次 list 看到 `out`；预览走现有 parse。聊天仍是 `tool/call` / `tool/result` 气泡。
5. CLI 可调同一工具。

## 7. 错误处理

| 情况 | 行为 |
|---|---|
| 缺 source / 缺 out | `failed: missing source` / `failed: missing out` |
| 越界 | `WorkspaceEscapeError`（与 fs） |
| hidden | `failed: hidden`（在 stat 之前） |
| source 不存在 | `failed: not found` |
| source 或已存在的 out 不是文件 | `failed: not a file` |
| out 扩展名不合法 | `failed: bad out` |
| 父目录不存在或不是目录 | `failed: missing parent`（不 mkdir） |
| 字节或字符超限 | `failed: too large` |
| parse 失败 | 原样 `failed: empty text` / `encrypted` / `unsupported type` / `unreadable` / `not found`；不写 out |
| writer / I/O 抛错 | `failed: unreadable`；已有 `out` 字节不变；本不存在则仍不存在 |
| abort | `aborted` |
| yml 无 docforge | schema 无 `doc_convert` |
| 无 Bearer | 现有 401；本片不新开 HTTP |
| 转换失败 | turn 继续，不升成 `model/error` |
| 聊天失败 | 已写出的文件留在工作区 |

`failed:` 理由只允许：`missing source`、`missing out`、`hidden`、`not found`、`not a file`、`bad out`、`missing parent`、`too large`、`unreadable`、`empty text`、`encrypted`、`unsupported type`。

本片**没有** `failed: bad source`（那是 generate 拒绝非 md 源）。未知扩展名走 `unsupported type`。

## 8. 安全

- 只绑现有 host `127.0.0.1`；token 不进转换文件、session、SSE。
- 两条路径都 `resolveInside`；hidden 规则与 ingest 相同。
- 不执行源 HTML 脚本；html 目标仍走 generate 的转义 writer。
- pdf/docx 不加载网络资源；字体只来自 generate 已嵌入的包内文件。
- 800_000 字节 / 200_000 字符上限。

## 9. 测试

使用现有 parse 测试 helper 现场写出 docx / pdf / xlsx（不必把二进制夹具提交进仓库），以及已提交的 `packages/docforge/tests/fixtures/hello.md`（`# Hello`、一段含「发展」、一行 `![skip](x.png)`）。

1. docx → md：正文含 `Hello`；JSON `from` 为 `docx`，`loss` 为 `images and complex formatting discarded`；键顺序为 `status`、`source`、`out`、`from`、`format`、`loss`。
2. pdf → html：含 `Hello`；`loss` 为 `images and layout discarded; text only`。
3. `hello.md` → pdf：`parse()` 含 `Hello` 与 `发展`；md → md：`loss` 为 `none` 且含 `![skip](x.png)`。
4. xlsx → md：有表或单元格文本；`loss` 为 xlsx 行。`out` 为 `.xlsx` → `failed: bad out`。
5. `empty.pdf` → `failed: empty text`，目标路径不存在。
6. 覆盖：先写旧 `out`，再 convert，内容变成新的。
7. 父目录不存在 → `failed: missing parent`，该路径仍不存在。
8. hidden、`../outside`、缺 source 先于缺 out。
9. `stat.size > GENERATE_MAX_BYTES` 的文件不把正文交给 `parse`。parse 截断超长 markdown → `failed: too large`，不写 `out`。
10. writer 失败：已有 `out` 字节不变。工具层把未知错误映射为 `failed: unreadable`。
11. `apply` 后 schemas 含 `doc_convert`；yml 去掉 docforge 则不含。`stop()` 后不含。
12. host `src` 无 `createDocConvertTool`。
13. 现有 generate/parse/ingest/预览/信息图/A2UI 测试保持绿。不打真实 DashScope。

## 10. 与总 spec / 前切片的关系

总 spec §10 `doc_convert` 本片落地为：**可 parse 的六种源 → generate 的四种目标**，并带固定 `loss`。写出 xlsx/pptx 仍留后续。`doc_probe` / `doc_parse` / `doc_generate` / `doc_ingest` 不变。parse 切片禁止的 pandoc/OCR/浏览器在本片同样禁止。

预览仍是 [文件预览设计](2026-08-17-flintloom-files-preview-design.md) 的 DocForge 分支。生成 writer 见 [生成设计](2026-08-17-flintloom-docforge-generate-design.md)。信息图 / A2UI 本片不改。

edit / compare / summarize、通道、`flint plugin add` 不在本片。

## 11. 实现顺序（本刀内）

1. `lossForConvert` + `convertDocument`（复用 `parse` / `buildDocument` / `GENERATE_MAX_*`）。
2. `createDocConvertTool` + `apply` 登记（parse 与 generate 之间）。
3. 夹具与工具测试；host factory 扫描加一条。
4. 第 9 节验收测试全绿。
