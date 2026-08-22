# FlintLoom 工作台工坊视觉设计

日期：2026-08-22  
状态：已审阅  
产品：FlintLoom — A real agent. / 真正的 Agent。  
范围：浏览器工作台的 **外观抛光**。不改 host API、SSE、`runTurn`、A2UI 协议、文件/知识库行为。

## 1. 这是什么

把现有 `pnpm desktop` 工作台从功能原型改成暖色工坊：暖炭灰底、琥珀强调、衬线标题、更清楚的层次。布局仍是「左聊天 / 右 Files+预览」，只加空状态文案和文件选中 class。

验收：打开 `http://127.0.0.1:5173`，顶栏是衬线 `FlintLoom`；空聊天可见「向工作区说一句话」；发送、点文件插路径、Files/Knowledge 切换与现在相同。`apps/desktop/tests/App.test.tsx` 全绿。不依赖真实 API key。

## 2. 复核后收紧的决策

| 点 | 决定 |
|---|---|
| 深度 | CSS + 少量结构（方案 2）。不重排成三栏。 |
| token | 颜色只写在 `:root` 变量。组件 CSS 只用 `var(--…)`，禁止再写 `#rrggbb`（`color-scheme` 除外）。 |
| 字体 | 只用系统栈。标题 `Georgia, "Palatino Linotype", Palatino, "Times New Roman", serif`。正文 `system-ui, "Segoe UI", sans-serif`。等宽 `ui-monospace, "Cascadia Code", Consolas, monospace`。不引入字体文件、CDN、npm 字体包。 |
| 空状态 | `bubbles.length === 0 && !draft` 时在 `.log` 内渲染 `<p class="log-empty">向工作区说一句话</p>`（不是 `button`）。有气泡或 streaming draft 则不渲染该节点。 |
| 状态胶囊 | 三种文案不变：`chat 已配置` / `chat 未配置` / `host 未连接`。包在 `<span className="status-pill ok|warn|down">`。已配置 `ok`，未配置 `warn`，host 未连接 `down`。未探测完成（`chatConfigured === undefined && !hostDown`）仍不渲染。 |
| 选中文件 | `FilePane` 仅当 `selectedFile === path` 时给**文件**按钮 `className="selected"`。`openFile` 行为不变：预览 + `onInsertPath`。目录按钮永不 `selected`。首屏自动 `startPreview` 第一份文件时 **不** 写 `selectedFile`（现网如此：预览有内容，但无选中高亮，直到用户点击）。 |
| 发送/取消 | `.composer button` 不能再统一涂主色。「发送」`className="btn-primary"`，「取消」`className="btn-ghost"`。Knowledge `Import` 仍无新 class，用 `.knowledge-footer button` 映射到与 `.btn-primary` 相同的规则。 |
| A2UI | 不改 `A2uiSurface.tsx` 逻辑。`.bubble.a2ui button` / `select` 用同一套控件色，避免浏览器默认按钮。 |
| 测试 class | 保留 `.file-preview`、`.file-preview-svg`、`.knowledge-search`、`textarea`、按钮可见文案。 |
| 动效 | 只允许 `transition` ≤ 150ms（hover/选中）。不引入动画库，不做页面入场动画。 |

## 3. 非目标

- 重排为「聊天 \| 树 \| 预览」三栏
- 改 host、代理、token、`.env` 模型配置
- 改 SSE / turn / cancel / A2UI wait 语义
- 改 Files 隐藏规则、预览 kind、Knowledge import/search
- markdown 预览渲染成 HTML
- 主题切换、亮色模式
- Electron、新依赖、新字体文件
- 改 CLI / webhook / Telegram

## 4. 架构

```text
apps/desktop/src/app.css     token + 全部外观
apps/desktop/src/App.tsx     空状态节点 + status-pill + btn-primary/ghost
apps/desktop/src/FilePane.tsx 文件按钮 selected class
（KnowledgePane / A2uiSurface 只吃 CSS，不改 TSX 逻辑）
```

数据流与 host 无关。无新路由。

## 5. Token

`:root` 固定这些变量（值按此表，不要改成冷灰或紫色）：

| 变量 | 值 | 用途 |
|---|---|---|
| `--bg` | `#161310` | 页面底 |
| `--bg-raised` | `#221c18` | 顶栏、composer、侧栏 |
| `--bg-panel` | `#2a231e` | 气泡、输入框、树行 hover |
| `--bg-paper` | `#1c1814` | 预览/知识详情 |
| `--text` | `#efe6d8` | 主文字 |
| `--text-muted` | `#a89880` | 次要、空状态、工具气泡 |
| `--line` | `#3d342c` | 分割线、边框 |
| `--accent` | `#d4a06a` | 标签下划线、助手气泡左边线、选中 |
| `--accent-strong` | `#c4843a` | 主按钮 |
| `--danger` | `#8f3e32` | error 气泡底 |
| `--bg-user` | `#3d2e1f` | 用户气泡 |
| `--btn-ink` | `#161310` | 主按钮字色（与 `--bg` 同值，单独成变量） |
| `--pill-down` | `#e0a090` | `down` 胶囊边/字 |

`html, body, #root`：`background: var(--bg); color: var(--text);`。`color-scheme: dark` 保留。

圆角：控件 8px，气泡 10px。主按钮 `background: var(--accent-strong); color: var(--btn-ink);`。禁用仍 `opacity: 0.45`。

## 6. 组件

### 6.1 顶栏 `.topbar`

高度约 48px，底 `var(--bg-raised)`，底边 `1px solid var(--line)`。`h1` 衬线、字重 600、字号 1.25rem、字色 `var(--text)`，去掉浏览器默认 margin。

胶囊：字号 0.75rem，padding `0.15rem 0.55rem`，圆角 999px，边框 1px。

- `.ok`：边/字 `var(--accent)`，底透明
- `.warn`：边/字 `var(--text-muted)`
- `.down`：边/字 `var(--pill-down)`

### 6.2 聊天 `.log` / `.bubble`

空状态：`.log-empty`，`flex: 1` + 居中，`var(--text-muted)`，不可点。

- `.user`：`align-self: flex-end`，底 `var(--bg-user)`（不要冷蓝）
- `.assistant` / `.draft`：`align-self: flex-start`，底 `var(--bg-panel)`，`border-left: 2px solid var(--accent)`
- `.tool-call` / `.tool-result`：等宽 0.85rem，色 `var(--text-muted)`，底 `var(--bg-paper)`
- `.error`：底 `var(--danger)`
- `.a2ui`：底 `var(--bg-panel)`，边 `1px solid var(--line)`

`max-width: 42rem` 保留。

### 6.3 Composer

底 `var(--bg-raised)`，顶边 `var(--line)`。textarea：底 `var(--bg)`，边 `var(--line)`，focus 边 `var(--accent)`（`outline: none`）。`.btn-primary` 主按钮。`.btn-ghost`：`background: transparent; border: 1px solid var(--line); color: var(--text);`。`.composer` 里不要写「所有 button 同色」。

### 6.4 侧栏 `.file-pane`

宽仍 `flex: 1; min-width: 16rem`。左边 `1px solid var(--line)`。`.side-tabs button.active` 底边 `2px solid var(--accent)`。

文件按钮：宽 100%、左对齐、透明底。`hover` 底 `var(--bg-panel)`。`.selected`：底 `var(--bg-panel)`，字色 `var(--accent)`。树/预览仍 `flex: 0.7` / `flex: 1`。`.file-preview` 底 `var(--bg-paper)`，padding 至少 `0.9rem 1rem`，行高 1.45，避免字贴边。

Knowledge：`.knowledge-search` 与 textarea 同控件；`.knowledge-footer button` 与发送同主按钮；列表项 hover 与文件行相同。

## 7. 测试

不改断言所依赖的文案与选择器：`发送`、`取消`、`Files`、`Knowledge`、`Import`、`host unreachable`、`textarea`、`pre.file-preview`、`input.knowledge-search`。

必须新增（写在 `apps/desktop/tests/App.test.tsx`）：

1. `installFetch()` + `mountApp()` 后 body 含「向工作区说一句话」；`document.querySelector(".log-empty")` 存在且 `tagName === "P"`。hydrate「past user」之后 **不含** 该句、`.log-empty` 为 null。
2. 默认 models mock（`configured: false`）下 `.status-pill.warn` 文案为 `chat 未配置`。`models` 抛错时 `.status-pill.down` 为 `host 未连接`。`configured: true` 时 `.status-pill.ok` 为 `chat 已配置`。
3. 点 `README.md` 后该 button `classList.contains("selected")`；点目录（现有 `docs` 夹具）后目录 button **没有** `selected`。首屏未点击时 `README.md` 也 **没有** `selected`。
4. 「发送」`classList.contains("btn-primary")`。出现「取消」时（sending/waiting）该 button `classList.contains("btn-ghost")`。

`pnpm exec vitest run apps/desktop/tests` 必须通过。`pnpm typecheck` exit 0。

## 8. 文件清单

| 文件 | 动作 |
|---|---|
| `apps/desktop/src/app.css` | 改：token + 上述外观 |
| `apps/desktop/src/App.tsx` | 改：空状态、`status-pill`、`btn-primary` / `btn-ghost` |
| `apps/desktop/src/FilePane.tsx` | 改：文件 `button` 的 `selected` |
| `apps/desktop/tests/App.test.tsx` | 改：上列 4 条断言 |

不改 `apps/host/**`、`packages/**`、yml、其它 apps。
