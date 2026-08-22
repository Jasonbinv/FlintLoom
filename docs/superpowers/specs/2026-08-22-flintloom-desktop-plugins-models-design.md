# FlintLoom 桌面插件与模型页设计

日期：2026-08-22  
状态：已审阅  
产品：FlintLoom — A real agent. / 真正的 Agent。  
范围：工作台 **只读** 插件列表与模型 kind 快照。不改 yml、不编辑密钥、不改 `runTurn`。

## 1. 这是什么

总 spec §13 要求工作台除聊天外有「插件列表（只读状态）」与「模型页（按 kind 配置 default，不堆厂商营销页）」。本片落地 host `GET /v1/plugins` 与桌面顶栏切换 Chat / Plugins / Models。

验收：`pnpm desktop` 顶栏可切页；Plugins 列出当前 runtime 已加载插件 id 与包名；Models 列出各 kind 的 `configured` 与 `defaultId`（无密钥）。`apps/desktop/tests` 与 host `server.test` 绿。

## 2. 收紧的决策

| 点 | 决定 |
|---|---|
| 插件 API | `GET /v1/plugins` → `[{ id, name, status: "loaded" }]`。来自 `createRuntime` 合并后的 `flintloom.yml` + MCP 自动行；不含 `config`、不含密钥。 |
| 模型 API | 复用 `GET /v1/models` → `ModelRegistry.snapshot()`，不扩展字段。 |
| 编辑 | v1 **不**提供桌面改 default、不写 credentials。提示文案指向 `.env` / credentials / yml。 |
| 导航 | 顶栏 `Chat` / `Plugins` / `Models`（与 Files/Knowledge 英文标签一致）。仅 Chat 页显示右侧 FilePane。 |
| host | 不 import 新 Loom 包；`Runtime.plugins` 在 `createRuntime` 时从 config 快照。 |
| 失败 | fetch 失败显示 `host unreachable`（与 Files 树一致）。 |

## 3. 非目标

- `flint plugin list` CLI、插件安装/卸载 UI
- 模型密钥编辑、provider 营销页
- Electron、新路由（仍是单页 state 切换）
- A2UI table/chart

## 4. 文件

| 文件 | 动作 |
|---|---|
| `apps/host/src/server.ts` | `Runtime.plugins`、`GET /v1/plugins` |
| `apps/host/tests/server.test.ts` | plugins HTTP 测试 |
| `apps/desktop/src/api.ts` | `fetchPlugins` |
| `apps/desktop/src/PluginsPane.tsx` | 新建 |
| `apps/desktop/src/ModelsPane.tsx` | 新建 |
| `apps/desktop/src/App.tsx` | 顶栏导航、按页渲染 |
| `apps/desktop/src/app.css` | 导航与设置页样式 |
| `apps/desktop/tests/App.test.tsx` | 切页与列表断言 |
