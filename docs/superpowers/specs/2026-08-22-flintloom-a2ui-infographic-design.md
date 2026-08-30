# FlintLoom A2UI Infographic 组件设计

日期：2026-08-22  
状态：已审阅  
范围：在 `flintloom:a2ui:core` 增加 **Infographic** 只读展示组件。盒线复用 `parseDocument` / `renderSvg` 与 Files 预览 `kind: svg`；AntV 语法走 `syntax` / `*.infographic.ig`，桌面用 `@antv/infographic` 渲染，host 只存文本。

## 1. 组件合约

四选一（互斥）：

```ts
{ id, component: "Infographic", document: InfographicDocument }
{ id, component: "Infographic", data: { path: "/ig" } }
{ id, component: "Infographic", file: "flow.infographic.json" | "steps.infographic.ig" }
{ id, component: "Infographic", syntax: "infographic list-row-simple-horizontal-arrow\\n..." }
```

- `document`：经 `parseDocument(JSON.stringify(...))` 校验  
- `file`：须 `isAnyInfographicRelPath`；`.json` 预览 `kind: svg`，`.ig` 预览 `kind: antv`  
- `syntax`：经 `parseAntvSyntax`（须以 `infographic` 开头；禁止远程 URL；≤64KB）  
- 不 wait；禁止远程 URL（沿用 infographic 规则）

## 2. 非目标

- xlsx/pptx 写出、交互编辑、新 host 路由
