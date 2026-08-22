# FlintLoom A2UI Infographic 组件设计

日期：2026-08-22  
状态：已审阅  
范围：在 `flintloom:a2ui:core` 增加 **Infographic** 只读展示组件，复用 `@flintloom/infographic` 的 `parseDocument` / `renderSvg` 与 Files 预览 `kind: svg`。

## 1. 组件合约

三选一（互斥）：

```ts
{ id, component: "Infographic", document: InfographicDocument }
{ id, component: "Infographic", data: { path: "/ig" } }
{ id, component: "Infographic", file: "flow.infographic.json" }
```

- `document`：经 `parseDocument(JSON.stringify(...))` 校验  
- `file`：须 `isInfographicRelPath`；桌面 `GET /v1/files/preview` 取 SVG  
- 不 wait；禁止远程 URL（沿用 infographic 规则）

## 2. 非目标

- xlsx/pptx 写出、交互编辑、新 host 路由
