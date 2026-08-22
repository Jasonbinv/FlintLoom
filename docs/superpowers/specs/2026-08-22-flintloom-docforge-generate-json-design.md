# FlintLoom DocForge 结构化 JSON 生成设计

日期：2026-08-22  
状态：已审阅  
范围：扩展 `doc_generate`：`source` 可为工作区 `.json`（`blocks` IR），写出与 markdown 源相同的六种目标格式。

## 1. 行为

- `source` 扩展名 `.json` → 解析 `{ "blocks": Block[] }`（与 generate IR 同形）
- 可选 shorthand：`{ "headers": string[], "rows": string[][] }` 单表
- 写出走现有 `buildDocument` writers；上限与 md 源相同
- `.md` / `.markdown` 行为不变；其它源仍 `bad source`

## 2. 非目标

- 工具参数内联 JSON、CSV 源、新工具名、mkdir
