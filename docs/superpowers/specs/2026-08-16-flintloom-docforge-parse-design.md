# FlintLoom DocForge 解析切片设计

日期：2026-08-16  
状态：已审阅  
产品：FlintLoom — A real agent. / 真正的 Agent。  
范围：总 spec 第二刀的 **DocForge 解析块**。只做 `doc_probe` / `doc_parse`。不做预览 UI、知识库、入库、转换/生成/编辑/对比/摘要、Electron、A2UI。

## 1. 这是什么

Agent 在工作区里对文档调用探测和解析，得到结构化 markdown，作为 `tool/result` 进入同一套 `runTurn`。预览面板和知识库下一刀复用本包纯函数，本切片不接 HTTP、不改页面。

不引入 dataagent-v3 / deepseek-harness，不拷贝其 Rust DocForge 引擎。

验收：工作区放一份 md / html / pdf / docx / pptx / xlsx 夹具；假 chat 或真实对话能调 `doc_parse` 得到可识别的 markdown。自动化测试只用仓库内夹具，不依赖真实 API key、不依赖本机 pandoc/OCR。

## 2. 复核后收紧的决策

相对初稿，下列歧义一律按此解释：

| 点 | 决定 |
|---|---|
| `parseable` | probe 表示「本切片有该类型解析器」，不是「一定抽得出正文」。扫描件 PDF 在 **parse** 时 `failed:`。 |
| 解析失败 | 返回稳定英文行 `failed: <reason>`，不让 turn 因文档失败而 `model/error`。越界仍抛 `WorkspaceEscapeError`（与 `fs` 相同）。 |
| 文本编码 | md / html **只按 UTF-8**。GBK 乱码不在本切片修。 |
| 旧格式 | `.doc` / `.xls` / `.ppt` / `.rtf` / 宏启用 `.docm` 等 → `unknown`。 |
| 加密/损坏 | 能认出类型则 probe 填 `type`；`parseable: false` 且 `reason` 为 `encrypted` 或 `unreadable`。parse 返回对应 `failed:`。 |
| pptx | 只抽幻灯正文文本框（`a:t`）。不要备注、图表、图片 OCR。 |
| xlsx | 每个可见工作表一张 markdown 表；空表仍输出 `##` 标题。 |
| 截断 | 与 `fs` read 相同：超过 200_000 字符截断并追加 `\n\n[truncated: output exceeded 200000 characters]`。 |
| 中止 | `exec.signal` 已 abort 则与 shell 一样结束，结果含 `aborted`。 |
| 不改 `runTurn` | 只多注册两个工具。 |

## 3. 非目标

- Electron、文件树、预览页、`GET /v1/files*`
- 个人知识库、`doc_ingest`、SQLite
- `doc_convert` / `doc_generate` / `doc_edit` / `doc_compare` / `doc_summarize`
- OCR、云对象存储、治理/脱敏
- 本机 pandoc / LibreOffice 子进程
- 修改工作台气泡语义
- 提交 `.env`

## 4. 架构

```text
Agent / flint
    doc_probe({ path })
    doc_parse({ path })
            │
            ▼
     @flintloom/docforge
        detect(absPath) → type
        probe(absPath)  → { type, pages?, parseable, reason? }
        parse(absPath)  → markdown | "failed: …"
            │
     resolveInside(workspaceRoot, path)
```

`apps/host` 的 `createRuntime` 在现有 `fs` / `grep` / `shell` 之后：

```ts
tools.register(createDocProbeTool());
tools.register(createDocParseTool());
```

工具只是薄封装：先 `resolveInside`，再调纯函数。预览/知识库以后直接 import 纯函数，不经过 tool schema。

## 5. 组件

### 5.1 包

`packages/docforge`，名 `@flintloom/docforge`，依赖 `@flintloom/tools` 以及下列 Node 库（均可在 Windows Node 22 无额外原生编译下跑测试）：

| 格式 | 库 | parse 形态 |
|---|---|---|
| `md` | 无 | UTF-8 原文，去掉 BOM |
| `html` | `node-html-markdown` | markdown |
| `docx` | `mammoth` | markdown（图片变成占位，不写二进制） |
| `xlsx` | `exceljs` | `## {sheetName}` + markdown 表 |
| `pptx` | `jszip` + 抽取 `ppt/slides/slide*.xml` 的 `a:t` | `## Slide {n}` + 文本 |
| `pdf` | `unpdf`（无 canvas、无 OCR）。若 Windows vitest 无法加载，允许换成同等 Node 纯文本库，测试断言不变 | `## Page {n}` + 该页文本 |

禁止：系统 poppler、tesseract、canvas 原生模块、从 dataagent 拷引擎。

### 5.2 类型探测

**已列出的扩展名优先**（`.md` 即使以 `<html` 开头仍是 `md`）。无扩展名或不在表内时再看魔数（例如无后缀的 `%PDF` 仍是 `pdf`）：

| type | 扩展名 | 魔数 |
|---|---|---|
| `pdf` | `.pdf` | `%PDF` |
| `docx` | `.docx` | ZIP 且内含 `word/` |
| `pptx` | `.pptx` | ZIP 且内含 `ppt/` |
| `xlsx` | `.xlsx` | ZIP 且内含 `xl/` |
| `html` | `.html` `.htm` | 或文本以 `<!DOCTYPE html` / `<html` 开头（大小写不敏感） |
| `md` | `.md` `.markdown` | （无魔数；不当成 html） |
| `unknown` | 其余 | |

`.doc` 虽可能被当成 OLE，本切片一律 `unknown`。

### 5.3 工具

`doc_probe`

- 参数：`{ path: string }`
- 成功：一行 JSON，键顺序 `type`、`pages`（可缺）、`parseable`、`reason`（可缺）
- `pages`：pdf 为页数；pptx 为幻灯数；xlsx 为工作表数；md/html/docx 省略
- `parseable: true`：上表六种类型且未判加密/损坏
- `parseable: false`：`unknown` / `encrypted` / `unreadable` / 文件不存在

`doc_parse`

- 参数：`{ path: string }`
- 成功：markdown 字符串（可被截断）
- 失败：只返回一行 `failed: unsupported type` | `failed: encrypted` | `failed: unreadable` | `failed: empty text` | `failed: not found` | `failed: missing path`
- 扫描件或抽空：`failed: empty text`
- 缺 `path`：两个工具都返回 `failed: missing path`（probe 此时不是 JSON）

工具描述必须写明：pdf/docx/pptx/xlsx/html 用 `doc_parse`，不要用 `fs` 当二进制读。

## 6. 数据流

1. 模型 `tool_call` → `ToolRegistry.execute`（已有 path 闸门 + 可选 guard）→ `doc_*`。
2. 越界：抛 `WorkspaceEscapeError`，loop 已有 catch，写入 `tool/result` 文本（现有行为）。
3. 解析失败：工具 **返回** `failed: …` 字符串，turn 继续。
4. 成功 markdown 写入 `tool/result`；不写 sidecar、不写知识库、不另开 session 事件类型。
5. 截断发生在纯函数返回前，模型只看见截断后的文本。

## 7. 错误处理

| 情况 | 行为 |
|---|---|
| 路径越界 | `WorkspaceEscapeError`（与 fs） |
| 文件不存在 | probe：`{"type":"unknown","parseable":false,"reason":"not found"}`；parse：`failed: not found` |
| 不支持类型 | probe `type: unknown`；parse `failed: unsupported type` |
| 加密 | probe `parseable: false`, `reason: encrypted`；parse `failed: encrypted` |
| 损坏 / 库抛错 | `unreadable` |
| 有类型但无字 | parse `failed: empty text` |
| 输出过长 | 截断，不算 failed |
| `signal` abort | 结果含 `aborted` |
| chat 未配置 | 与现网相同，本切片不改 |

「文件不存在」probe 用 JSON 而 parse 用 `failed:` 行，避免把 JSON 和 markdown 混在 parse 通道里。

## 8. 测试

夹具放 `packages/docforge/tests/fixtures/`（可提交的小文件）：

- `sample.md` — 含标题 `# Hello`
- `sample.html` — 含 `<h1>Hello</h1>`
- `sample.pdf` — 至少一页可选中文字或 ASCII `Hello`
- `sample.docx` — 含 Hello
- `sample.pptx` — 一页 Hello
- `sample.xlsx` — 一表 Hello
- `empty.pdf` — 合法 PDF 但无可抽文本（扫描件代理）
- `binary.bin` — 随机字节

断言：

1. 六种成功夹具：`probe.parseable === true`；`parse` 含 `Hello`（xlsx 含表头或单元格文本）。
2. `binary.bin`：probe `unknown`；parse `failed: unsupported type`。
3. `empty.pdf`：parse 为 `failed: empty text`。
4. `../outside`：抛 `WorkspaceEscapeError`。
5. 超长 md（测试里临时写文件）：含 truncated 标记。
6. host：`createRuntime` 的 `tools.schemas()` 含 `doc_probe` 与 `doc_parse`。
7. 现有 host / loop / fs / grep / shell 测试不得被本切片改坏。

不在 CI 里打真实 DashScope。

## 9. 安全

- 路径 `resolveInside`，与 fs/grep/shell 同一闸门。
- 解析库只读工作区内文件。
- 不把 API key 写入文档解析结果。
- html 只转 markdown，不执行脚本。
- 只绑定现有 host `127.0.0.1`；本切片不新开端口。

## 10. 与总 spec / 工作台切片的关系

总 spec §10 / §16 第二刀：本切片交付 `doc_probe` + `doc_parse`。  
`doc_ingest` 与预览 HTTP/UI 是第二刀后续块。  
`doc_generate` 见 [生成设计](2026-08-17-flintloom-docforge-generate-design.md)。convert/edit/compare/summarize 仍待拆。  
工作台继续只消费现有 SSE；解析结果以现有 `tool/call` / `tool/result` 气泡出现。
