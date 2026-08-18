# FlintLoom DocForge 对比切片设计

日期：2026-08-19  
状态：已复核  
产品：FlintLoom — A real agent. / 真正的 Agent。  
范围：总 spec 第三刀的 **`doc_compare` 块**。两份工作区文档先 parse 成 markdown，再做行级 unified diff。挂在现有 `@flintloom/docforge` 的 `apply` 上，yml 不新加插件。禁止再往 `createRuntime` 里 `register`。本片不做 summarize，不写盘，不改 A2UI catalog，不改 Files preview `kind`。

## 1. 这是什么

Agent 调用 `doc_compare({ a, b })`，把两边能 parse 的文件抽成 markdown，规范化换行后做行 diff。成功 JSON 带 unified 文本（或两份相同则 `identical: true` 且 `diff` 为空串）。用来给模型看差异，而不是两份全文。不写工作区文件。

验收：夹具 `hello.md` 与一份只把 `# Hello` 改成 `# Hi` 的副本相比，JSON 键顺序为 `status`、`a`、`b`、`identical`、`diff`；`identical` 为 `false`；`diff` 含 `-# Hello` 与 `+# Hi`。同一文件比自己 → `identical: true`、`diff` 为 `""`。`flint` 仍能跑完一轮。自动化测试不依赖真实 API key、不依赖本机 Word / Chrome / pandoc / git diff。

## 2. 复核后收紧的决策

| 点 | 决定 |
|---|---|
| 源 | 两边都是可 parse 的六种：`detectType(path, bytes)` 两参数为 md / html / pdf / docx / pptx / xlsx。禁止单参 `detectType(path)`。其余 → `failed: unsupported type`。 |
| 比什么 | **parse 后的 markdown**，不是原文件字节。pdf 对 docx 比的是抽出的文本。 |
| 参数 | 必填 `a` + `b`，均为工作区路径。不另传 `out`。同一路径出现两次允许。 |
| 取 markdown | 抽出 `parseToMarkdown`：与现有 `parse()` 同一套六种 parser，返回判别联合（成功 markdown 或失败 reason）。**不做** empty-text 失败、**不做** `truncateOutput`。禁止用 `startsWith("failed: ")` 判断（正文可以以该前缀开头）。`parse()` 仍先调它，再 empty + 截断，故 `doc_parse` / `doc_convert` 不变。 |
| 规范化 | 每边 markdown 再走 `normalizeMarkdown`（去 BOM；`\r\n` / `\r` → `\n`）。**不** `copyMarkdown`（不补末尾换行、不因此制造虚假 diff）。 |
| 相同 | 规范化后字符串全等 → `identical: true`，`diff` 为 `""`，不调用 patch 库。空正文对空正文属于这种情况。CRLF 与 LF 同文 → identical。 |
| diff | 否则 `diff.createTwoFilesPatch(aRel, bRel, aMd, bMd, undefined, undefined, { context: 3 })`。头是工作区相对路径（`\`→`/`），**不用** git 的 `a/` `b/` 前缀。 |
| 写盘 | **不写**。没有 `.diff` 文件，不覆盖 `a`/`b`。 |
| 上限 | 复用 `GENERATE_MAX_BYTES`（800_000）与 `GENERATE_MAX_CHARS`（200_000）。每边先 `stat.size` 再读/parse。规范化后任一边 `.length > GENERATE_MAX_CHARS` → `too large`。拼出的 patch `.length > GENERATE_MAX_CHARS` → `too large`，不出 JSON。不静默截断。 |
| parse 失败 | `parseToMarkdown` 返回 `{ ok: false, reason }` 时抛 `Error(reason)`。`reason` 仅为 `not found` / `unreadable` / `unsupported type` / `encrypted`。没有 `empty text`。 |
| 预览 | 不改 `FilePreview.kind`。 |
| 工具工厂 | `apps/host/src` 不得出现 `createDocCompareTool`。host / desktop / loop / session 不得 import `compareDocuments` / `parseToMarkdown`。 |
| 并发 | 只读；两次 compare 不排队。 |

## 3. 非目标

- `doc_summarize`
- 写出 `.diff` / `.xlsx` / `.pptx`；mkdir；OCR
- 词级 diff、HTML 并排、三路 merge、按字节/zip 比 office 文件
- 改 `parse()` 的 empty-text / 截断语义
- 自动 `doc_ingest`
- 引入 dataagent-v3 / deepseek-harness / Cordis
- 改 loop / session / 聊天气泡语义、Files preview `kind`
- 系统 `git diff` / `fc`

## 4. 架构

```text
Agent
  doc_compare({ a, b })
        │
  resolveInside 两条路径
  hidden / 存在且是文件 / 大小（先 a 后 b）
        │
  parseToMarkdown(a) → normalizeMarkdown → 字符上限
  parseToMarkdown(b) → normalizeMarkdown → 字符上限
        │
        ├─ 两串相等 → identical true, diff ""
        └─ createTwoFilesPatch(..., { context: 3 })
              └─ patch 超 GENERATE_MAX_CHARS → too large
                    │
              {"status":"ok","a","b","identical","diff"}
```

yml 仍是现在的 `docforge` 行。`apply` 在 `createDocEditTool` 之后、`createDocIngestTool` 之前登记 `createDocCompareTool`。去掉 `docforge` 行 → schema 无 probe/parse/convert/generate/edit/**compare**/ingest。

新增 npm 依赖：`diff` ^8（jsdiff，自带类型，不要 `@types/diff`）。只用 `createTwoFilesPatch`。禁止 `RegExp` 拿用户路径当模式。

## 5. 组件

### 5.1 导出

```ts
export type ParseMarkdownResult =
  | { ok: true; markdown: string }
  | {
      ok: false;
      reason: "not found" | "unreadable" | "unsupported type" | "encrypted";
    };

export async function parseToMarkdown(
  absPath: string,
): Promise<ParseMarkdownResult>;

export async function compareDocuments(
  absA: string,
  absB: string,
  aRel: string,
  bRel: string,
): Promise<{ identical: boolean; diff: string }>;
```

`parseToMarkdown`：现有 `parse()` 的读盘 + `detectType` + 六种 parser + 加密映射。成功为 `{ ok: true, markdown }`（可以为空串，或正文以 `failed:` 开头）。失败为 `{ ok: false, reason }`。不检查 empty text，不调用 `truncateOutput`。

`parse()` 必须改为：

```ts
const result = await parseToMarkdown(absPath);
if (!result.ok) {
  return `failed: ${result.reason}`;
}
const trimmed = result.markdown.replace(/\s+/g, " ").trim();
if (trimmed.length === 0) {
  return "failed: empty text";
}
return truncateOutput(result.markdown);
```

`compareDocuments` **不做** hidden / 工作区闸门。步骤：

1. 对 **a** 再对 **b**：`stat` ENOENT → `not found`；不是文件 → `unreadable`（工具层会先拦 `not a file`）；`size > GENERATE_MAX_BYTES` → `too large`（不读正文）。
2. `parseToMarkdown`。若 `!ok`，抛 `Error(reason)`。
3. `normalizeMarkdown`；`.length > GENERATE_MAX_CHARS` → `too large`。
4. `aMd === bMd` → 返回 `{ identical: true, diff: "" }`。
5. `createTwoFilesPatch(aRel, bRel, aMd, bMd, undefined, undefined, { context: 3 })`。结果 `.length > GENERATE_MAX_CHARS` → `too large`。
6. 返回 `{ identical: false, diff }`。`diff` 为库返回的完整字符串（含末尾换行若库带上）。

`aRel` / `bRel` 由工具层传入，已是工作区相对且 `\`→`/`。

### 5.2 工具 `doc_compare`

```ts
{
  name: "doc_compare",
  description:
    "Compare two workspace documents by parsing each to markdown and returning a unified diff. Pass a and b. Identical files return identical true and an empty diff. Do not use this to rewrite files (use doc_edit or fs) or to summarize (use doc_summarize later).",
  parameters: {
    type: "object",
    properties: {
      a: { type: "string" },
      b: { type: "string" },
    },
    required: ["a", "b"],
  },
}
```

成功：

```ts
JSON.stringify({
  status: "ok",
  a: aRel,
  b: bRel,
  identical, // JSON boolean
  diff,
})
```

键顺序固定为 `status`、`a`、`b`、`identical`、`diff`。不把任一边的全文另开字段放进 result。

检查顺序（命中即返回）：

1. `signal.aborted` → `aborted`
2. `a` 缺或非非空字符串 → `failed: missing a`
3. `b` 缺或非非空字符串 → `failed: missing b`
4. `resolveInside(a)`、`resolveInside(b)`（越界抛 `WorkspaceEscapeError`）
5. 请求 path 或 resolve 后的 rel 对 **任一条** 命中 `isHiddenRelPath` → `failed: hidden`（在 stat 之前）
6. `stat(a)`：ENOENT → `failed: not found`；不是文件 → `failed: not a file`；`size > GENERATE_MAX_BYTES` → `failed: too large`
7. 对 **b** 重复步骤 6
8. 调用 `compareDocuments`；抛错且 `message` 在第 7 节理由表 → `failed: <message>`，否则 `failed: unreadable`
9. 成功 JSON

`failFromError` 允许本片新理由 `missing a` / `missing b`，以及 parse 的 `encrypted` / `unsupported type`（generate 不会抛这两项）。

### 5.3 插件

```ts
ctx.effect(tools.register(createDocEditTool()));
ctx.effect(tools.register(createDocCompareTool()));
ctx.effect(tools.register(createDocIngestTool(kb)));
```

`stop()` 后 schema 无 `doc_compare`。

### 5.4 Host / Desktop

不改 `files.ts` preview。factory 扫描在现有 `createDocEditTool` 旁增加 `createDocCompareTool`。不要用正则禁止单词 `compare`。

## 6. 数据流

1. Boot：yml 加载 docforge → 现有工具 + `doc_compare`。
2. `tool_call` → 路径闸门 + `tools/pre-execute` → `parseToMarkdown` 两边 → unified → `tool/result`。
3. 不写 sidecar、不入库、不新开 session 事件。
4. Files 预览不变。CLI 可调同一工具。

## 7. 错误处理

| 情况 | 行为 |
|---|---|
| 缺 a / 缺 b | `failed: missing a` / `failed: missing b`；缺 a 先于缺 b |
| 越界 | `WorkspaceEscapeError` |
| hidden | `failed: hidden` |
| 路径不存在 | `failed: not found` |
| 存在但不是文件 | `failed: not a file` |
| 字节、规范化后 markdown、或 patch 超限 | `failed: too large` |
| 不可 parse 的类型 | `failed: unsupported type` |
| 加密 | `failed: encrypted` |
| I/O 或其它 | `failed: unreadable` |
| abort | `aborted` |
| yml 无 docforge | schema 无 `doc_compare` |

`failed:` 理由只允许：`missing a`、`missing b`、`hidden`、`not found`、`not a file`、`too large`、`unsupported type`、`encrypted`、`unreadable`。

没有 `empty text`、`missing path`、`bad source`、`bad out`、`missing parent`。空文件参与 diff。两边都不存在时只报先查到的 `not found`（a 先）。失败不写盘。

## 8. 安全

- 只绑现有 host `127.0.0.1`。
- `resolveInside`；hidden 与 ingest 相同；hidden 在 stat 之前。
- 不把系统绝对路径或 stack 放进 `failed:`。
- 800_000 字节 / 200_000 字符上限（含 patch）。
- 依赖 `diff` 只做行 patch，不 eval、不读网。

## 9. 测试

使用已提交的 `packages/docforge/tests/fixtures/hello.md` 与 `binary.bin`。不提交新二进制夹具。

1. `hello.md` vs 把 `# Hello` 换成 `# Hi` 的副本：键顺序 `status`、`a`、`b`、`identical`、`diff`；`identical === false`；`diff` 含 `-# Hello` 与 `+# Hi`；`发展` 仍可作为上下文出现。
2. `hello.md` vs 自己：`identical === true`，`diff === ""`。
3. 两个空 `.md`：`identical === true`。
4. 同文 CRLF vs LF：`identical === true`。
5. `doc_parse` 对空 `.md` 仍是 `failed: empty text`；对正文为 `failed: empty text\n# Hello` 的 md 仍成功（回归：判别联合，禁止 `startsWith("failed: ")`）。
6. `binary.bin` → `failed: unsupported type`。缺 `a` 先于缺 `b`。hidden、`../outside`、`stat.size > GENERATE_MAX_BYTES`。
7. 规范化后超 `GENERATE_MAX_CHARS`、以及 patch 超限 → `too large`（可用临时大文件或对 `compareDocuments` 的超长串）。
8. `apply` 含 `doc_compare`；yml 去掉 docforge 则不含。`stop()` 后不含。
9. host `src` 无 `createDocCompareTool`。
10. 现有 parse/generate/convert/edit/ingest/预览/信息图/A2UI 保持绿。

## 10. 与总 spec / 前切片的关系

总 spec §10 `doc_compare` 本片落地为：**六种可 parse 源 → markdown → 行级 unified diff**，成功 JSON，不写盘。`doc_probe` / `doc_parse` / `doc_convert` / `doc_generate` / `doc_edit` / `doc_ingest` 不变（`parse()` 仅内部抽出共享函数）。

预览仍是 [文件预览设计](2026-08-17-flintloom-files-preview-design.md) 的 DocForge 分支。

`doc_summarize`、通道、`flint plugin add` 不在本片。

## 11. 实现顺序（本刀内）

1. `parseToMarkdown` + `compareDocuments`（含 `diff` 依赖）。
2. `createDocCompareTool` + `apply` 登记。
3. 夹具与工具测试；host factory 扫描。
4. 第 9 节验收全绿。
