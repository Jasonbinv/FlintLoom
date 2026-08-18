# FlintLoom DocForge 编辑切片设计

日期：2026-08-18  
状态：已复核  
产品：FlintLoom — A real agent. / 真正的 Agent。  
范围：总 spec 第三刀的 **`doc_edit` 块**。对工作区 markdown 做一次精确子串替换并原地覆盖。挂在现有 `@flintloom/docforge` 的 `apply` 上，yml 不新加插件。禁止再往 `createRuntime` 里 `register`。本片不做 compare / summarize，不改 pdf/docx，不改 A2UI catalog，不改 Files preview `kind`。

## 1. 这是什么

Agent 调用 `doc_edit({ path, old, new })`，在工作区 markdown 里把恰好出现一次的 `old` 换成 `new`（`new` 可空表示删除），然后原地写回。用来改一处标题或删一行，避免 `fs` 整文件重写。

验收：夹具 `hello.md`（含 `# Hello`、`发展`、`![skip](x.png)`）把 `# Hello` 换成 `# Hi` 后，文件含 `Hi` 与「发展」；同一 `old` 出现两次则失败且字节不变。`flint` 仍能跑完一轮。自动化测试不依赖真实 API key。

## 2. 复核后收紧的决策

| 点 | 决定 |
|---|---|
| 源 | 只改 markdown。`detectType(path, bytes)` 两参数必须为 `md`（`.md` / `.markdown`）。docx/pdf 等 → `failed: bad source`。禁止单参 `detectType(path)`。 |
| 参数 | `path` + `old` 必填非空。`new` 可缺省或 `""`（删除）。不另传 `out`。 |
| 匹配 | 读盘 UTF-8；去 BOM；CRLF→LF；再对正文做精确子串。不折叠空白、不用正则。 |
| 次数 | **非重叠**计数（`indexOf` 后从 `i + old.length` 继续）。0 → `not found`；≥2 → `not unique`。都不写盘。 |
| 写回 | 一律 LF、无 BOM；若不以 `\n` 结尾则补一个 `\n`（与 generate 的 md 拷贝相同）。一次 `writeFile(path)`。 |
| 空串 | `old` 空 → `missing old`。`new` 空 = 删除那一处。没有 `missing new`。 |
| 写盘 | 不 `mkdir`。原地覆盖已有文件。 |
| 上限 | 复用 `GENERATE_MAX_BYTES`（800_000）与 `GENERATE_MAX_CHARS`（200_000）。先 `stat.size` 再读盘。规范化后、以及 `copyMarkdown` 之后 `.length > GENERATE_MAX_CHARS` → `too large`，不写。 |
| 预览 | 不改 `FilePreview.kind`。 |
| 工具工厂 | `apps/host/src` 不得出现 `createDocEditTool`。host / desktop / loop / session 不得 import `editMarkdown`。 |
| 并发 | 两次 edit 不排队，后写覆盖先写。 |

## 3. 非目标

- `doc_compare` / `doc_summarize`
- 改 pdf / docx / html / xlsx / pptx（那是 convert + generate）
- unified diff、一次调用多组替换、按行号替换
- mkdir、OCR、自动 `doc_ingest`
- 引入 dataagent-v3 / deepseek-harness / Cordis
- 改 loop / session / 聊天气泡语义、Files preview `kind`

## 4. 架构

```text
Agent
  doc_edit({ path, old, new })
        │
  resolveInside(path)
  hidden / 存在且是文件 / 大小 / detectType === md
        │
  读盘 UTF-8 → 去 BOM → CRLF→LF
        │
  old 非重叠出现次数
        ├─ 0  → failed: not found
        ├─ ≥2 → failed: not unique
        └─ 1  → 换成 new（可空=删除）→ 补末尾 \n → writeFile(path)
                    │
              {"status":"ok","path","replaced":1}
```

yml 仍是现在的 `docforge` 行。`apply` 在 `createDocGenerateTool` 之后、`createDocIngestTool` 之前登记 `createDocEditTool`。去掉 `docforge` 行 → schema 无 probe/parse/convert/generate/**edit**/ingest。

不新增 npm 依赖。

## 5. 组件

### 5.1 导出

```ts
export function normalizeMarkdown(raw: string): string;
export function countNonOverlap(haystack: string, needle: string): number;

export async function editMarkdown(
  absPath: string,
  old: string,
  replacement: string,
): Promise<{ replaced: 1 }>;
```

`normalizeMarkdown`：去 BOM；`\r\n` / 单独 `\r` → `\n`。不补末尾换行（补换行在替换成功之后，与 `copyMarkdown` 一致：去 BOM 后若不以 `\n` 结尾则补 `\n`）。

`countNonOverlap`：`needle` 为空则调用方不得使用（工具层已拒）。实现用 `indexOf`，命中后 `i += needle.length`，禁止 `RegExp`。

`editMarkdown` **不做** hidden / 工作区闸门。步骤：

1. `old.length === 0` → 抛 `Error("missing old")`。
2. `stat`：ENOENT → `not found`；不是文件 → `unreadable`（工具层会先拦 `not a file`）。
3. `size > GENERATE_MAX_BYTES` → `too large`（不读正文）。
4. `readFile`；`detectType(absPath, bytes)` 两参数不是 `md` → `bad source`。
5. `normalizeMarkdown(bytes.toString("utf8"))`；`.length > GENERATE_MAX_CHARS` → `too large`。
6. `countNonOverlap`：0 → `not found`；≥2 → `not unique`。
7. 次数为 1 时用一次非重叠替换（`indexOf` + `slice`，或 `split`/`join`；禁止 `RegExp`）。然后 `copyMarkdown` 补末尾 `\n`。**此时** `.length > GENERATE_MAX_CHARS` → `too large`（含补换行后刚好超限）。
8. `writeFile`。I/O 失败 → `unreadable`。已有文件在失败时字节不变。
9. 返回 `{ replaced: 1 }`。

### 5.2 工具 `doc_edit`

```ts
{
  name: "doc_edit",
  description:
    "Replace one exact substring in a workspace markdown file. Pass path, old, and new; new may be empty to delete. old must occur exactly once after newline normalization. Do not use this to rewrite a whole file (use fs) or to edit pdf/docx (convert to md first).",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      old: { type: "string" },
      new: { type: "string" },
    },
    required: ["path", "old"],
  },
}
```

`required` 不含 `new`。成功：

```ts
JSON.stringify({
  status: "ok",
  path: pathRel, // 工作区相对，\ → /
  replaced: 1,
})
```

键顺序固定为 `status`、`path`、`replaced`。不把文件正文放进 result。

检查顺序（命中即返回）：

1. `signal.aborted` → `aborted`
2. `path` 缺或非非空字符串 → `failed: missing path`
3. `old` 缺或非非空字符串 → `failed: missing old`
4. `new`：键缺失或 `undefined` → 当 `""`。若存在但不是 string → `failed: bad new`
5. `resolveInside(path)`（越界抛 `WorkspaceEscapeError`）
6. 请求 path 或 resolve 后的 rel 命中 `isHiddenRelPath` → `failed: hidden`（在 stat 之前）
7. `stat(path)`：ENOENT → `failed: not found`；不是文件 → `failed: not a file`
8. `stat.size > GENERATE_MAX_BYTES` → `failed: too large`（不 `readFile`）
9. 调用 `editMarkdown`；抛错且 `message` 在第 7 节理由表 → `failed: <message>`，否则 `failed: unreadable`；**不写 / 不改** 文件
10. 成功 JSON

`failed: not found` 既表示路径不存在，也表示规范化后 `old` 出现 0 次（与已批准设计一致）。

### 5.3 插件

```ts
ctx.effect(tools.register(createDocGenerateTool()));
ctx.effect(tools.register(createDocEditTool()));
ctx.effect(tools.register(createDocIngestTool(kb)));
```

`stop()` 后 schema 无 `doc_edit`。

### 5.4 Host / Desktop

不改 `files.ts` preview。factory 扫描在现有 `createDocConvertTool` 旁增加 `createDocEditTool`。不要用正则禁止单词 `edit`。

## 6. 数据流

1. Boot：yml 加载 docforge → 现有工具 + `doc_edit`。
2. `tool_call` → path 闸门 + `tools/pre-execute` → `editMarkdown` → `writeFile`。
3. `tool/result` 为成功 JSON 或 `failed:` / `aborted`。不写 sidecar、不入库、不新开 session 事件。
4. 文件树下次预览仍走 parse。CLI 可调同一工具。

## 7. 错误处理

| 情况 | 行为 |
|---|---|
| 缺 path / 缺 old | `failed: missing path` / `failed: missing old` |
| `new` 不是 string | `failed: bad new` |
| 越界 | `WorkspaceEscapeError` |
| hidden | `failed: hidden` |
| 路径不存在，或 `old` 出现 0 次 | `failed: not found` |
| `old` 出现 ≥2 次 | `failed: not unique` |
| path 不是文件 | `failed: not a file` |
| path 不是 md | `failed: bad source` |
| 字节或字符超限 | `failed: too large` |
| I/O | `failed: unreadable`；已有文件字节不变 |
| abort | `aborted` |
| yml 无 docforge | schema 无 `doc_edit` |

`failed:` 理由只允许：`missing path`、`missing old`、`bad new`、`hidden`、`not found`、`not a file`、`too large`、`bad source`、`not unique`、`unreadable`。

## 8. 安全

- 只绑现有 host `127.0.0.1`。
- `resolveInside`；hidden 与 ingest 相同。
- 不用正则，避免 `old` 里的特殊字符变成模式。
- 800_000 字节 / 200_000 字符上限（含替换后）。

## 9. 测试

使用已提交的 `packages/docforge/tests/fixtures/hello.md`。

1. `# Hello` → `# Hi`：含 `Hi` 与 `发展`；JSON `replaced` 为 `1`；键顺序 `status`、`path`、`replaced`。
2. `new: ""` 删掉 `![skip](x.png)`：该语法消失，其余仍在。
3. 文件里写两段相同 `old` → `failed: not unique`，字节与调用前相同。
4. `old` 不存在 → `failed: not found`；缺 `old` → `failed: missing old`；缺 `path` 先于缺 `old`。
5. CRLF 源 + LF 的 `old` 命中；写回无 `\r`、无 BOM、末尾 `\n`。
6. overlapping：正文 `aaa`、`old` 为 `aa` → 非重叠计数为 1，可以替换。
7. `sample.docx`（或任意非 md）→ `failed: bad source`。hidden、`../outside`、`stat.size > GENERATE_MAX_BYTES`。
8. `apply` 含 `doc_edit`；yml 去掉 docforge 则不含。`stop()` 后不含。
9. host `src` 无 `createDocEditTool`。
10. 现有 generate/convert/parse/ingest/预览/信息图/A2UI 保持绿。

## 10. 与总 spec / 前切片的关系

总 spec §10 `doc_edit` 本片落地为：**工作区 markdown 上一次精确唯一替换**。pdf/docx 编辑仍留「先 convert 成 md」。`doc_probe` / `doc_parse` / `doc_convert` / `doc_generate` / `doc_ingest` 不变。

预览仍是 [文件预览设计](2026-08-17-flintloom-files-preview-design.md) 的 DocForge 分支。

compare / summarize、通道、`flint plugin add` 不在本片。

## 11. 实现顺序（本刀内）

1. `normalizeMarkdown` + `countNonOverlap` + `editMarkdown`。
2. `createDocEditTool` + `apply` 登记。
3. 夹具与工具测试；host factory 扫描。
4. 第 9 节验收全绿。
