# FlintLoom DocForge 摘要切片设计

日期：2026-08-19  
状态：已复核  
产品：FlintLoom — A real agent. / 真正的 Agent。  
范围：总 spec 第三刀的 **`doc_summarize` 块**。工作区文档 parse 成 markdown 后，由工具内层调用 `chat.stream` 生成短摘要。挂在现有 `@flintloom/docforge` 的 `apply` 上，yml 不新加插件。禁止再往 `createRuntime` 里 `register`。本片不改 loop / session 事件、不扩展 `ToolExec`、不扩展 `ChatRequest`、不改 `@flintloom/models-chat`、不写盘、不改 A2UI catalog、不改 Files preview `kind`。

## 1. 这是什么

Agent 调用 `doc_summarize({ path })`，把能 parse 的文件抽成 markdown，再让当前默认 chat 模型写一段短摘要。成功 JSON 只带摘要。外层 `tool/result`（因而下一轮 prompt 的投影）只有这段 JSON，**没有**文档全文。内层 `stream` **不是** session 事件：不写 `assistant/chunk`、不写第二条 `tool/call`。总 spec「摘要写入 log」落地为：标准 `tool/result` 里的短 JSON；「全文不塞进下一次 prompt」落地为：全文只出现在内层 user 消息。

这是总 spec §7「模型看见的，必须先记进 log」的**有意例外**：内层模型看见全文，全文不进 session log。外层模型只看见已入 log 的摘要 JSON。§11「未配置 chat → turn 失败并写 `model/error`」「chat HTTP 错误 → SSE `error`、turn `failed`」只约束**外层** loop。内层缺 chat / HTTP / `error` chunk / 抛错一律变成工具串 `failed: unreadable`：不发 `model/error`、不把 turn 标 failed，外层 step 继续。

验收：夹具 `hello.md` 配假 `ChatProvider`，成功 JSON 键顺序为 `status`、`path`、`summary`；假 chat 的 user 内容含 `# Hello` 与 `发展`；返回的 `summary` 不含全文。空文件 → `failed: empty text` 且不调 stream。无 chat → `failed: unreadable`。`flint` 仍能跑完一轮。自动化测试不依赖真实 API key。

## 2. 复核后收紧的决策

| 点 | 决定 |
|---|---|
| 源 | 可 parse 的六种：`detectType(path, bytes)` 两参数为 md / html / pdf / docx / pptx / xlsx。禁止单参 `detectType(path)`。其余 → `failed: unsupported type`。 |
| 取 markdown | 复用 `parseToMarkdown`。禁止用 `startsWith("failed: ")` 判断（正文可以以该前缀开头）。 |
| 空正文 | 与 `parse()` 相同：`markdown.replace(/\s+/g, " ").trim()` 长度为 0 → `failed: empty text`，**不**调 chat。空对空在 compare 里可以 identical；summarize **不允许**空正文。 |
| 规范化 | empty 检查之后 `normalizeMarkdown`（去 BOM；`\r\n` / `\r` → `\n`）。**不** `copyMarkdown`。**不** `truncateOutput`（避免把 `[truncated]` 塞进内层 prompt）。 |
| 上限 | 复用 `GENERATE_MAX_BYTES`（800_000）与 `GENERATE_MAX_CHARS`（200_000）。先 `stat.size` 再读/parse。规范化后 `.length > GENERATE_MAX_CHARS` → `too large`，不送模型。摘要另有硬顶 **4000** 个 JS 字符串 `.length`：更长则 `slice(0, 4000)`，**不**追加 `[truncated]`。 |
| 模型 | `apply` 里 `ctx.require("models")`，工厂闭包 `ModelRegistry`。**每次 `execute`**（parse 成功且未超限之后）再 `resolveChat()`。禁止 `apply` 时 `resolveChat()`：`models-chat` 无 API key 时不登记 chat，否则 DocForge 整插件起不来。缺 chat → `failed: unreadable`，不发明 `missing chat`。 |
| 内层请求 | `chat.stream({ messages, tools: [] }, exec.signal)`。两参数 API；`signal` 不进 `ChatRequest`。`messages` 只有 system + user，**不**带外层 `deriveMessages()`。`ChatRequest` 只有 `messages` + `tools`：本片不加 `max_tokens` / `temperature` / `tool_choice`，4000 上限只靠事后 `slice`。`tools` 必须传 `[]`（类型必填）。现有 openai-compat 在 `tools.length === 0` 时**不**把 `tools` 写入 HTTP body；本片不改 `@flintloom/models-chat`。 |
| 闸门 | 外层 `doc_summarize` 仍走现有 `tools/pre-execute` / `guard`。内层 `stream` **不**再进 waterfall、**不**执行任何工具。 |
| system 原文 | 见第 5.1 节常量 `SUMMARIZE_SYSTEM`。禁止改字。 |
| chunk | 只拼接 `type === "text"`。`tool_call` 忽略、不执行；若同时有 text 与 `tool_call`，只要 text 非空即成功，忽略 `tool_call`。若整段流没有任何 text → `unreadable`。`type === "error"` 立即 `unreadable`，丢弃已拼文本，不把 `message` 回给外层。 |
| 摘要正文 | 除 `slice(0, SUMMARIZE_MAX_CHARS)` 外原样保留：不 `trim`、不剥 markdown fence、不折叠空白。拼接后 `.length === 0` 才 `unreadable`；只有空格的摘要仍算成功。 |
| 写盘 | **不写**。 |
| 预览 | 不改 `FilePreview.kind`。 |
| 工具工厂 | `apps/host/src` 不得出现 `createDocSummarizeTool`。host / desktop / loop / session 不得 import `summarizeDocument`。 |
| 并发 | 两次 summarize 不排队。 |
| 依赖 | `@flintloom/models` 升为 `@flintloom/docforge` 的 runtime `dependencies`。不新增其它 npm 包。 |

## 3. 非目标

- 写出 `.xlsx` / `.pptx`；mkdir；OCR
- A2UI table / chart / Infographic；通道 / webhook / Telegram / `flint plugin add`
- 新 session 事件；扩展 `ToolExec`；给 `ChatProvider` 加 `complete()`；给 `ChatRequest` 加字段
- 改 `@flintloom/models-chat` / openai-compat（含为 `tools: []` 显式写 `tool_choice`）
- 把摘要写成工作区文件；把内层 token 流到桌面
- 超大文档 map-reduce（超限即 `too large`）
- 改 `parse()` 的 empty-text / 截断语义
- 自动 `doc_ingest`
- 引入 dataagent-v3 / deepseek-harness / Cordis
- 改 loop / session / 聊天气泡语义、Files preview `kind`

## 4. 架构

```text
Agent
  doc_summarize({ path })
        │
  resolveInside / hidden / 文件 / GENERATE_MAX_BYTES
        │
  parseToMarkdown → empty text → normalizeMarkdown → GENERATE_MAX_CHARS
        │
  models.resolveChat()
        │
  chat.stream({ messages: [system, user=markdown], tools: [] }, signal)
        │
  concat text chunks → slice(0, 4000)
        │
  {"status":"ok","path","summary"}
```

yml 仍是现在的 `docforge` 行。`apply` 在 `createDocCompareTool` 之后、`createDocIngestTool` 之前登记 `createDocSummarizeTool(models)`。去掉 `docforge` 行 → schema 无 probe/parse/convert/generate/edit/compare/**summarize**/ingest。

内层 `stream` 不写入 session、不经 `guard`。外层只有一次 `tool/call` + 一次 `tool/result`（JSON 或 `failed:` / `aborted`）。`index.ts` 与 compare 同级导出 `summarizeDocument`、`SUMMARIZE_MAX_CHARS`、`SUMMARIZE_SYSTEM`、`createDocSummarizeTool`。

## 5. 组件

### 5.1 导出

```ts
export const SUMMARIZE_MAX_CHARS = 4000;

export const SUMMARIZE_SYSTEM =
  "Summarize the document in the user message. Write the summary only. Use the same language as the document. Do not call tools. Do not wrap the summary in markdown fences.";

export type SummarizeResult =
  | { ok: true; summary: string }
  | {
      ok: false;
      reason:
        | "aborted"
        | "not found"
        | "not a file"
        | "too large"
        | "unsupported type"
        | "encrypted"
        | "empty text"
        | "unreadable";
    };

export async function summarizeDocument(
  absPath: string,
  models: ModelRegistry,
  signal: AbortSignal,
): Promise<SummarizeResult>;
```

`summarizeDocument` **不做** hidden / 工作区闸门。步骤：

1. 若 `signal.aborted` → `{ ok: false, reason: "aborted" }`。
2. `stat`：ENOENT → `not found`；不是文件 → `not a file`（工具层会先拦 `not a file`）；`size > GENERATE_MAX_BYTES` → `too large`（不读正文）。其它 I/O → `unreadable`。
3. `parseToMarkdown`。若 `!ok`，返回其 `reason`。
4. `parsed.markdown.replace(/\s+/g, " ").trim().length === 0` → `empty text`。
5. `normalizeMarkdown`；`.length > GENERATE_MAX_CHARS` → `too large`。
6. `models.resolveChat()`。`ModelKindMissingError` → `unreadable`。
7. `chat.stream({ messages: [{ role: "system", content: SUMMARIZE_SYSTEM }, { role: "user", content: markdown }], tools: [] }, signal)`。
8. 迭代 chunk：`text` 拼接；`tool_call` 忽略；`error` → 立即 `unreadable`（已拼文本丢弃）。抛错时若 `signal.aborted` → `aborted`，否则 `unreadable`。`ModelKindMissingError.message`（`未配置 chat`）不得出现在返回值里。
9. 循环结束后若 `signal.aborted` → `aborted`。
10. 拼接结果 `.length === 0` → `unreadable`。不 `trim`。
11. 返回 `{ ok: true, summary: joined.slice(0, SUMMARIZE_MAX_CHARS) }`。不剥 fence。

### 5.2 工具 `doc_summarize`

```ts
{
  name: "doc_summarize",
  description:
    "Summarize a workspace document by parsing it to markdown and asking the chat model. Returns JSON with a short summary. Pass path. Do not use this to rewrite files (use doc_edit or fs) or to compare (use doc_compare).",
  parameters: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  },
}
```

工厂：`createDocSummarizeTool(models: ModelRegistry)`。

成功：

```ts
JSON.stringify({
  status: "ok",
  path: pathRel,
  summary: result.summary,
})
```

键顺序固定为 `status`、`path`、`summary`。`pathRel` 为工作区相对路径且 `\`→`/`。不把 markdown 全文另开字段放进 result。

检查顺序（命中即返回）：

1. `signal.aborted` → `aborted`
2. `path` 缺或非非空字符串 → `failed: missing path`
3. `resolveInside(path)`（越界抛 `WorkspaceEscapeError`）
4. 请求 path 或 resolve 后的 rel 命中 `isHiddenRelPath` → `failed: hidden`（在 stat 之前）
5. `stat`：ENOENT → `failed: not found`；不是文件 → `failed: not a file`；`size > GENERATE_MAX_BYTES` → `failed: too large`
6. `try` 调用 `summarizeDocument`。`ok: true` → 成功 JSON。`reason === "aborted"` → `aborted`；其它 `{ ok: false }` → `failed: <reason>`。抛错时若 `signal.aborted` → `aborted`，否则 `failFromError`

`failFromError` 不新增理由。`ModelKindMissingError` 在 `summarizeDocument` 内已映射为 `unreadable`；其 `message` 是 `未配置 chat`，不在 `FAIL_REASONS` 里，即使漏 catch 也只能变成 `unreadable`，不得原样回给外层模型。

`execute` 把 `exec.signal` 原样传给 `summarizeDocument`。内层失败不抛给 `runTurn`（避免被当成工具异常并把原文塞进 `tool/result`）。

同步改 `doc_compare` 的 description：去掉 “later”，改为 `use doc_summarize`。

### 5.3 插件

```ts
const models = ctx.require<ModelRegistry>("models");
const kb = ctx.require<KnowledgeService>("knowledge");
// ...
ctx.effect(tools.register(createDocCompareTool()));
ctx.effect(tools.register(createDocSummarizeTool(models)));
ctx.effect(tools.register(createDocIngestTool(kb)));
```

`apply` **不得**调用 `resolveChat()`。无 chat 时其它 DocForge 工具仍可登记。`stop()` 后 schema 无 `doc_summarize`。无 `models` 插件时 `require("models")` 抛错（与无 knowledge 相同）。

### 5.4 Host / Desktop

不改 `files.ts` preview。factory 扫描在现有 `createDocCompareTool` 旁增加 `createDocSummarizeTool`。不要用正则禁止单词 `summarize`。loop / session / desktop 不 import `summarizeDocument`。

yml 去掉 docforge 的 host 测试同时断言 schema 无 `doc_summarize`。默认 assembly 的 schema 断言含 `doc_summarize`。

## 6. 数据流

1. Boot：yml 加载 docforge → 现有工具 + `doc_summarize`。此时可以没有 chat。
2. 外层 `tool_call` → 路径闸门 + `tools/pre-execute` / `guard` → parse → `resolveChat` → 内层 `stream`（无 session 事件、不再进 waterfall）→ `tool/result`（JSON 或失败串）。
3. 下一 Agent step 的投影只含该 `tool/result`，不含内层 user markdown。
4. 内层 chat 出错时 turn **继续**（工具失败串）；只有外层 `runTurn` 自己的 chat 失败才走 §11 的 `model/error` / turn `failed`。
5. 不写 sidecar、不入库。Files 预览不变。CLI 可调同一工具。

## 7. 错误处理

| 情况 | 行为 |
|---|---|
| 缺 path | `failed: missing path` |
| 越界 | `WorkspaceEscapeError` |
| hidden | `failed: hidden` |
| 路径不存在 | `failed: not found` |
| 存在但不是文件 | `failed: not a file` |
| 字节或规范化后 markdown 超限 | `failed: too large` |
| 不可 parse 的类型 | `failed: unsupported type` |
| 加密 | `failed: encrypted` |
| 空白正文 | `failed: empty text` |
| 缺 chat、stream 抛错、`error` chunk、无 text | `failed: unreadable`（不是 `model/error`，turn 不因此 failed） |
| abort（入口 / stream 中 / stream 后） | `aborted`（不是 `failed: aborted`） |
| yml 无 docforge | schema 无 `doc_summarize` |

`failed:` 理由只允许：`missing path`、`hidden`、`not found`、`not a file`、`too large`、`unsupported type`、`encrypted`、`empty text`、`unreadable`。

没有 `missing chat`、`missing a`、`bad source`。chunk / API 原文不进 `failed:`。失败不写盘。正文以 `failed:` 开头不是错误。

## 8. 安全

- 只绑现有 host `127.0.0.1`。
- `resolveInside`；hidden 与 ingest 相同；hidden 在 stat 之前。
- 不把系统绝对路径或 stack 放进 `failed:`。
- 源文 800_000 字节 / 200_000 字符；摘要 4000 字符。
- 内层 `tools: []`；忽略 `tool_call`，不在内层执行工具，不重入 `guard`。
- 全文不进 `tool/result`、不进 session log。
- 内层 `error` chunk 的 `message`（可能含 HTTP 原文）丢弃；openai-compat 已 redact key，本片仍不外传。

## 9. 测试

使用已提交的 `packages/docforge/tests/fixtures/hello.md` 与 `binary.bin`。不提交新二进制夹具。`ChatProvider` 一律假对象；不打真实网。失败路径断言 `stream` 调用次数为 0。假 `stream` 签名必须是 `(req, signal)`；成功路径断言传入的 `signal` 就是 `exec.signal`。

1. `hello.md`：假 stream 产出 `"Short summary."` → 键顺序 `status`、`path`、`summary`；`path === "hello.md"`；`summary === "Short summary."`（不含 `发展`）。假 chat 收到的 user 含 `# Hello` 与 `发展`；system 等于 `SUMMARIZE_SYSTEM`；`req.tools` 为 `[]`。
2. 0 字节 `.md`，以及只有空白（空格 / 换行）的 `.md` → `failed: empty text`，stream 未调用。
3. 正文以 `failed: empty text\n# Hello` 开头的 md 仍走 stream（禁止 `startsWith("failed:")`）。
4. `binary.bin` → `failed: unsupported type`，stream 未调用。
5. 缺 `path`、hidden、缺文件、目录、`../outside`（`WorkspaceEscapeError`）、`stat.size > GENERATE_MAX_BYTES`、规范化后超 `GENERATE_MAX_CHARS`。
6. 未 `registerChat` 的 `ModelRegistry` → `failed: unreadable`，stream 未调用（对一份非空 md）；返回值不含 `未配置 chat`。
7. 假 stream 产出长度 `4001` 的串 → `summary.length === 4000`，且不含 `[truncated]`。
8. 只有 `tool_call` chunk → `unreadable`。先 text 再 `tool_call` → 成功，`summary` 为那段 text。`error` chunk（含已有部分 text 之后）→ `unreadable`，不得把 chunk.message 放进返回值。
9. stream 中 abort → `"aborted"`。
10. CRLF 源文件：假 chat 收到的 user 为 LF（`normalizeMarkdown`），不含 `\r`。
11. `apply` 含 `doc_summarize`；yml 去掉 docforge 则不含。`stop()` 后不含。无 models 插件时 apply 抛 `models`。host 默认 assembly 的 schema **含** `doc_summarize`。
12. host `src` 无 `createDocSummarizeTool`。loop / session / desktop 不 import `summarizeDocument`。
13. 现有 parse / generate / convert / edit / compare / ingest / 预览 / 信息图 / A2UI 保持绿。

## 10. 与总 spec / 前切片的关系

总 spec §10 `doc_summarize` 本片落地为：**六种可 parse 源 → markdown → 内层 `chat.stream` → 最多 4000 字摘要 JSON**。摘要作为标准 `tool/result` 进 log；全文只在内层 user 消息。`doc_probe` / `doc_parse` / `doc_convert` / `doc_generate` / `doc_edit` / `doc_compare` / `doc_ingest` 行为不变。

预览仍是 [文件预览设计](2026-08-17-flintloom-files-preview-design.md) 的 DocForge 分支。对比仍是 [对比设计](2026-08-19-flintloom-docforge-compare-design.md)。

通道、`flint plugin add`、xlsx/pptx 写出不在本片。

总 spec §10 该行已指向本文件。

## 11. 实现顺序（本刀内）

1. `@flintloom/models` 升为 runtime 依赖；`summarizeDocument` + 常量。
2. `createDocSummarizeTool` + `apply` 登记；改 `doc_compare` description。
3. 夹具与工具测试；host factory 扫描与 yml omit。
4. 第 9 节验收全绿。
