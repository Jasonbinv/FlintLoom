# FlintLoom DocForge xlsx / pptx 写出设计

日期：2026-08-22  
状态：已审阅  
范围：扩展 `doc_generate` 与 `doc_convert` 的 `out` 支持 `.xlsx` / `.pptx`。

## 1. 行为

- `formatFromOutRelPath` 识别 `.xlsx` / `.pptx`
- `buildDocument`：`exceljs` 写表；`jszip` 写最小 pptx（`ppt/slides/slideN.xml`）
- 从 `parseBlocks` IR：标题/段落/列表/代码/表格 → 行或幻灯片文本
- `lossForConvert`：新目标格式沿用源类型行（md→xlsx 同 md→pdf）
- 不写 mkdir；覆盖已有文件；上限与 generate 相同

## 2. 非目标

- 公式、图表、主题、动画、图片嵌入
