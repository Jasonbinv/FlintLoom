# FlintLoom A2UI DataTable / Chart 设计

日期：2026-08-22  
状态：已审阅  
范围：在 `flintloom:a2ui:core` 增加 **DataTable**、**Chart** 展示组件。只读，不触发 wait。

## 1. 组件合约

### DataTable

```ts
{ id, component: "DataTable", headers: string[], rows: string[][] }
// 或
{ id, component: "DataTable", data: { path: "/tbl" } }
// data model: { headers: string[], rows: string[][] }
```

- headers：1–20 列，每列 ≤200 字符  
- rows：0–100 行，每行长度须等于 headers 长度，单元格 ≤2000 字符  
- 不 wait（无 Button / ChoicePicker）

### Chart

```ts
{ id, component: "Chart", kind?: "bar" | "hbar" | "line" | "area" | "scatter" | "pie" | "doughnut" | "radar" | "heatmap", labels: string[], values: number[] }
// heatmap instead:
{ id, component: "Chart", kind: "heatmap", xLabels: string[], yLabels: string[], values: number[][] }
// 或
{ id, component: "Chart", kind?: "...", data: { path: "/chart" } }
// series data model: { labels: string[], values: number[] }
// heatmap data model: { xLabels: string[], yLabels: string[], values: number[][] }
```

- labels：1–24 项，每项 ≤80 字符  
- values：与 labels 等长，有限 number  
- heatmap：`xLabels`/`yLabels` 各 1–24 项；`values` 为 `number[][]`，行数 = yLabels，每行长度 = xLabels  
- kind 默认 `bar`；别名 `column`→`bar`，`donut`→`doughnut`，`barh`/`horizontalBar`→`hbar`，`spider`→`radar`，`heat_map`/`heat-map`→`heatmap`  
- 桌面用内联 SVG 渲染，禁止远程资源

## 2. 非目标

- Infographic 组件、交互式图表、远程 CDN
- 改 loop / host 路由
