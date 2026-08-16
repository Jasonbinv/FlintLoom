# FlintLoom 工作台（浏览器切片）设计

日期：2026-08-16  
状态：已审阅  
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
- 启动顺序：探测 `http://127.0.0.1:7331/v1/models`。连接失败则 `startHost({ workspaceRoot: process.cwd(), homeDir: os.homedir(), port: 7331 })`。已有进程：用本机 `loadOrCreateToken` 带 Bearer 再 GET；200 则复用，非 200 则退出并打印 `port 7331 in use`。然后起 Vite，`server.host = 127.0.0.1`，`server.port = 5173`。
- 浏览器只访问 5173。不给 7331 加 CORS，页面不直连 7331。
- 代理读取 `~/.flintloom/credentials` 的 `hostToken`（没有则 `loadOrCreateToken`）。转发时加上 `Authorization: Bearer <token>`。响应原样回传（含 `text/event-stream`）。
- 工作区：host 的 `workspaceRoot` 为执行 `pnpm desktop` 时的 `process.cwd()`。这一刀不做工作区选择器。
- 模型配置：host 必须读取工作区 `.env` 的 `FLINTLOOM_*`（进程环境变量优先，其次 `.env`，再次 credentials `chatApiKey`）。工作台不编辑密钥。若该加载逻辑尚未合入 `dev`，本切片实现计划第一项补上。

## 4. 界面

单列工作台（`apps/desktop`，React + Vite），**深色**单一主题：

- 顶栏：产品名 FlintLoom；chat 是否已配置（来自 `GET /v1/models` 里 `kind === "chat"` 的 `configured`）。未配置时仍可发消息，失败气泡走 `model/error`。
- 消息列表：
  - `user/message` → 用户气泡
  - `assistant/chunk` → 追加到当前助手草稿（流式）
  - `assistant/message` → 助手气泡定稿（草稿合并为这一条，不再另留 chunk 气泡）
  - `tool/call` → 工具行：名称 + `JSON.stringify(args)` 截断至 200 字符
  - `tool/result` → 工具结果，超过 2000 字符截断并加 `…`
  - `model/error` → 错误气泡，展示 `message`
  - `turn/start`、`turn/end`、SSE `{ type: "end", status }` 不单独成气泡；`end.status` 结束「发送中」
- 发送：先在本地插入用户气泡，再 `POST /v1/turns`。该轮 SSE 里的 `user/message` **丢弃**（避免双气泡）。
- 刷新：用同一 `sessionId` 调 `GET /v1/sessions/:id`；200 则按事件列表重建气泡（此时 **要** 渲染历史里的 `user/message`）；404 当新会话。
- 底栏：多行输入；Enter 发送，Shift+Enter 换行；发送中按钮变为取消。
- 取消：收到 `turn/start` 的 `turnId` 后，`POST /v1/turns/:id/cancel`（经同一代理）。取消前尚未收到 `turnId` 则按钮可点但请求等到有 id 再发。
- `sessionId`：每个浏览器标签页一个 UUID，`sessionStorage` 键名 `flintloom.sessionId`。

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
  index.html
  tsconfig.json
  vite.config.ts        127.0.0.1:5173 + /v1 代理
  src/main.tsx
  src/App.tsx
  src/sse.ts
  src/api.ts
  src/types.ts          与 host SSE 对齐的事件联合类型
  tests/sse.test.ts
  tests/App.test.tsx
scripts/desktop-dev.ts
```

根 `package.json`：`"desktop": "tsx scripts/desktop-dev.ts"`。  
根 `vitest.config.ts` 增加 `apps/**/tests/**/*.test.tsx`。根 `tsconfig.json` `include` 增加 `apps/*/src/**/*.tsx`、`apps/*/tests/**/*.tsx`，desktop 的 tsconfig 设 `"jsx": "react-jsx"`。

不新增 Express，不引入 `http-proxy`。Vite `configureServer` 中间件用内置 `fetch` 把 `/v1/*` 转到 `http://127.0.0.1:7331`，SSE 把上游 `body` 流式写入响应。host 启动复用 `@flintloom/host` 的 `startHost` / `loadOrCreateToken`。独立 `apps/host/src/listen.ts` 仅用于「只起 host、不起 Vite」，不是 `pnpm desktop` 的入口。

## 7. 测试

- `sse.ts`：输入字符串含两行 `data:`（`assistant/chunk` text `hi`，再 `{ type: "end", status: "ok" }`），解析结果含 chunk 与 end。
- `App`：mock `fetch`/`ReadableStream`，夹具 SSE 为 chunk `hi` + `assistant/message` `hello` + `end`；用户气泡由 UI 本地插入；断言出现 `hello`。不启动真实 host。
- 再一例：夹具 `model/error`，断言错误气泡含 `message`。
- `desktop-dev` 的 7331 探测可单测：对假 HTTP 服务，无进程 → 应调用 start；401 裸 GET 且 Bearer 200 → 不 start；Bearer 非 200 → 抛 `port 7331 in use`。
- 现有 host/CLI/loop 测试不得被工作台改坏。

## 8. 安全

- 只绑定 `127.0.0.1`（Vite 与 host）。
- `hostToken` 与模型 key 不得出现在页面 HTML、前端 bundle、SSE 展示文本（展示的是模型回复，不是密钥）。
- 继续不提交 `.env`。

## 9. 与总 spec 的关系

总 spec 第 16 节第二刀其余部分（预览、知识库、DocForge）和第三刀的 A2UI 不在本切片。Electron 主进程以后替换「Vite 代理补 token」这一层，页面 API 仍走同源 `/v1`。
