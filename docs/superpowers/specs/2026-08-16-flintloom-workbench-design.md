# FlintLoom 工作台（浏览器切片）设计

日期：2026-08-16  
状态：待审阅  
产品：FlintLoom — A real agent. / 真正的 Agent。  
范围：总 spec 第二刀的**第一块**。不做 Electron、文件预览、个人知识库、DocForge、A2UI。

## 1. 这是什么

在浏览器里打开本机工作台，对着当前工作区发一句话，页面通过现有 Flint host（`127.0.0.1:7331`）跑 `runTurn`，用 SSE 把 session 事件画成气泡。

不引入 dataagent-v3 / deepseek-harness，不拷贝旧 Electron 代码。

验收：`pnpm desktop` 后打开 `http://127.0.0.1:5173`，发「读 README 并总结」；有模型 key 时能看到用户气泡、工具调用、助手回复。自动化测试用固定 SSE 夹具，不依赖真实 API key。

## 2. 非目标

- Electron 窗口（总 spec 的薄 Electron 留给后续切片）
- 文件树、预览、知识库、DocForge、A2UI、信息图
- 页面里填写或展示 `hostToken` / `FLINTLOOM_API_KEY`
- 云、登录、BFF 服务进程
- 修改 `runTurn` 语义（工作台只消费现有 host API）

## 3. 运行时

```text
浏览器  127.0.0.1:5173
   │  GET /  页面
   │  POST /v1/turns   ──┐
   │  GET  /v1/models    │  Vite 插件代理（补 Bearer）
                         ▼
                    Flint host  127.0.0.1:7331
                         │
                      runTurn / tools / chat
```

- 命令：`pnpm desktop`（仓库根 `package.json`）。
- 启动顺序：若 `127.0.0.1:7331` 已在听则复用；否则用 `startHost({ workspaceRoot: process.cwd(), homeDir: os.homedir(), port: 7331 })` 拉起。然后起 Vite，`server.host = 127.0.0.1`，`server.port = 5173`。
- 浏览器只访问 5173。不给 7331 加 CORS，页面不直连 7331。
- 代理读取 `~/.flintloom/credentials` 的 `hostToken`（没有则走现有 `loadOrCreateToken`）。把 `Authorization: Bearer <token>` 加到转发请求上。响应原样回传（含 `text/event-stream`）。
- 工作区：host 的 `workspaceRoot` 为执行 `pnpm desktop` 时的 `process.cwd()`。这一刀不做工作区选择器。
- 模型配置：继续用工作区 `.env` / `FLINTLOOM_*` / credentials `chatApiKey`。工作台不编辑密钥。

## 4. 界面

单列工作台（`apps/desktop`，React + Vite）：

- 顶栏：产品名 FlintLoom；chat 是否已配置（来自 `GET /v1/models` 里 `kind === "chat"` 的 `configured`）。未配置时仍可发消息，失败气泡走 `model/error`。
- 消息列表：
  - `user/message` → 用户气泡
  - `assistant/chunk` → 追加到当前助手草稿（流式）
  - `assistant/message` → 助手气泡定稿
  - `tool/call` → 工具行：名称 + 参数摘要
  - `tool/result` → 工具结果（过长截断显示，默认前 2000 字符）
  - `model/error` → 错误气泡
  - 其它事件（`turn/start`、`turn/end`、SSE `{ type: "end", status }`）不单独成气泡；`end` 的 `status` 用于结束「发送中」状态
- 底栏：多行输入；Enter 发送，Shift+Enter 换行；发送中按钮变为取消。
- 取消：收到 `turn/start` 的 `turnId` 后，`POST /v1/turns/:id/cancel`（经同一代理）。
- `sessionId`：每个浏览器标签页一个 UUID，放在 `sessionStorage`，刷新同标签续同一 session。

视觉保持克制：深色或浅色单一主题即可，不仿 dataagent 营销页。

## 5. 前端数据流

1. 页面加载：`GET /v1/models`（经代理）。失败则顶栏显示「host 未连接」。
2. 发送：`POST /v1/turns`，JSON `{ sessionId, text }`，`Accept: text/event-stream`。
3. 按行解析 `data: ...`。JSON `type === "end"` 结束读取。
4. 解析失败的单行跳过，不拆整轮。
5. 网络错误：错误气泡，文案 `host unreachable`（英文固定，便于测）。

## 6. 包与文件

```text
apps/desktop/
  package.json          @flintloom/desktop
  vite.config.ts        127.0.0.1:5173 + /v1 代理
  src/main.tsx
  src/App.tsx           工作台壳
  src/sse.ts            解析 SSE 行 → 事件
  src/api.ts            models / turns / cancel（相对路径 /v1）
  src/App.test.tsx      夹具渲染
  src/sse.test.ts
scripts/desktop-dev.ts  复用或拉起 host，再启动 Vite
```

根 `package.json`：`"desktop": "tsx scripts/desktop-dev.ts"`。

不新增 Express，不引入 `http-proxy`。Vite `configureServer` 中间件用内置 `fetch` 把 `/v1/*` 转到 `http://127.0.0.1:7331`，SSE 用响应 body 原样 pipe。host 启动复用 `@flintloom/host` 的 `startHost` / `loadOrCreateToken`。

## 7. 测试

- `sse.ts`：给定两行 `data:`（一段 `assistant/chunk` text `hi`，再 `{ type: "end", status: "ok" }`），解析结果含 chunk 与 end。
- `App`：用固定 SSE 体（`user` 已由 UI 本地插入；夹具返回 `assistant/chunk` + `assistant/message` + `end`），不启动真实 host、不读 API key；断言助手气泡文本。
- 再一例：夹具返回 `model/error`，断言错误气泡出现。
- 现有 host/CLI/loop 测试不得被工作台改坏。

## 8. 安全

- 只绑定 `127.0.0.1`（Vite 与 host）。
- `hostToken` 与模型 key 不得出现在页面 HTML、前端 bundle、SSE 展示文本（展示的是模型回复，不是密钥）。
- 继续不提交 `.env`。

## 9. 与总 spec 的关系

总 spec 第 16 节第二刀其余部分（预览、知识库、DocForge）和第三刀的 A2UI 不在本切片。Electron 主进程以后替换「Vite 代理补 token」这一层，页面 API 仍走同源 `/v1`。
