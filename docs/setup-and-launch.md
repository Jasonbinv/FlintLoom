# FlintLoom 设置与启动指南

本文说明从零配置到启动工作台（浏览器 / Electron / CLI）的完整流程。

---

## 1. 环境要求

| 项 | 要求 |
|----|------|
| Node.js | **≥ 22**（见根 `package.json` `engines`） |
| 包管理器 | **pnpm 10**（`packageManager: pnpm@10.14.0`） |
| 操作系统 | Windows / macOS / Linux |

安装 pnpm（若尚未安装）：

```bash
corepack enable
corepack prepare pnpm@10.14.0 --activate
```

---

## 2. 获取代码与安装依赖

在仓库根目录（**工作区根目录**）执行：

```bash
cd FlintLoom
pnpm install
```

**工作区根目录**：Agent 实际读写的项目目录，必须包含 `flintloom.yml`。Host 会从这里加载 `flintloom.yml`、`.env`、`mcp-servers.yml`。

解析顺序：

1. `~/.flintloom/workspace` 中持久化的路径（若有效）
2. 否则为启动命令时的当前目录（`process.cwd()`）

因此：首次 `pnpm desktop` 在哪个目录执行，默认工作区就是哪里；之后可在工作台侧栏 **「选择工作区」** 切换，路径会写入 `~/.flintloom/workspace` 并在下次启动时复用。CLI 仍可用 `pnpm flint --workspace <路径>` 临时指定。

Electron 二进制安装在 `apps/electron` 子包中。若首次运行 `pnpm desktop:app` 报错找不到 Electron，可在根目录重试安装：

```bash
pnpm install
node apps/electron/node_modules/electron/install.js
```

网络较慢时可使用镜像（PowerShell）：

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
node apps/electron/node_modules/electron/install.js
```

---

## 3. 两类「密钥」不要混用

FlintLoom 有两套凭据，用途不同：

| 凭据 | 存放位置 | 用途 |
|------|----------|------|
| **模型 API Key** | 工作区 `.env` 中的 `FLINTLOOM_API_KEY` 等 | 调用 OpenAI 兼容模型（Qwen、DeepSeek 等） |
| **Host 本地 Token** | `~/.flintloom/credentials` 的 `hostToken` | 桌面 / CLI 访问本机 Host API（`http://127.0.0.1:7331`） |

- 模型 Key：**你自己配置**（见下一节）。
- Host Token：**首次启动时自动生成**，无需手写；Vite 代理和 CLI 会自动读取。

---

## 4. 配置模型（`.env`）

1. 复制模板：

```bash
cp .env.example .env
```

2. 编辑工作区根目录的 `.env`，填入模型厂商信息。示例（通义千问 OpenAI 兼容接口）：

```env
FLINTLOOM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
FLINTLOOM_API_KEY=sk-你的密钥
FLINTLOOM_CHAT_MODEL=qwen3.7-plus
```

3. 优先级：**进程环境变量** 高于 `.env` 文件。

4. 配置成功后，工作台**左侧状态区**会显示 **「chat 已配置」**；未配置时聊天不可用。

DeepSeek 等其它厂商可参考 `.env.example` 中的注释切换 `BASE_URL` 与 `CHAT_MODEL`。

本地 **llama-server**（`http://127.0.0.1:8080/v1`）仅 overlay 文本 chat；媒体 kind 与 guard 不会随本地 URL 显示「已配置」。可用 `FLINTLOOM_MEDIA_*` / `FLINTLOOM_GUARD_*` 单独挂云端能力。详见 [本地llama部署模型.md](./本地llama部署模型.md)。

### 4.1 工作台设置（本机凭据与通道）

侧栏 **「设置」** 页可将 chat / media / guard 以及 **Telegram / Discord / Slack / 飞书** 写入 `~/.flintloom/credentials`（不修改工作区 `.env`）。保存后 host 会 `POST /v1/settings/reload` 重载 runtime（有对话进行中时会提示稍后再试）。

**优先级：** 进程环境变量 > 工作区 `.env` > `~/.flintloom/credentials`。若在 `.env` 已配置某 slot，生效值来自 `.env`；Models 页只读展示当前生效状态。

| API | 说明 |
|-----|------|
| `GET /v1/settings/credentials` | 各 slot 脱敏快照（无完整密钥） |
| `PUT /v1/settings/credentials/:slotId` | 写入 credentials（`chat` / `media` / `guard` / `telegram` / `discord` / `slack` / `feishu`） |
| `GET /v1/settings/workspace` | 当前工作区绝对路径 |
| `POST /v1/settings/workspace` | 切换工作区（JSON `{ workspaceRoot }`；目录需含 `flintloom.yml`） |
| `POST /v1/settings/reload` | 重建 runtime（保持通道轮询） |

Webhook 入站复用 `hostToken`（`~/.flintloom/credentials`），地址见设置页或 `http://127.0.0.1:7331/v1/hooks`。

个人微信可通过独立桥接 `pnpm wechat-bridge` 转发到 webhook，见 [wechat-bridge.md](./wechat-bridge.md)（有封号风险，建议小号 + HTTP 模式联调）。

#### 通道环境变量（可选，也可在设置页填写）

| 通道 | Token / 密钥 | 允许的 ID（逗号分隔） |
|------|----------------|------------------------|
| Telegram | `FLINTLOOM_TELEGRAM_TOKEN` | `FLINTLOOM_TELEGRAM_CHAT_IDS` |
| Discord | `FLINTLOOM_DISCORD_TOKEN` | `FLINTLOOM_DISCORD_CHANNEL_IDS` |
| Slack | `FLINTLOOM_SLACK_TOKEN` | `FLINTLOOM_SLACK_CHANNEL_IDS` |
| 飞书 | `FLINTLOOM_FEISHU_APP_ID` + `FLINTLOOM_FEISHU_APP_SECRET` | `FLINTLOOM_FEISHU_CHAT_IDS`（`oc_…`） |

Host 在 `startHost` / `pnpm desktop` 且凭据齐全时会自动轮询入站；CLI 单轮 `pnpm flint` 不轮询。

---

## 5. 插件与 MCP（可选）

### 5.1 默认插件

仓库根已有 `flintloom.yml`，列出 models、tools、loop、docforge、a2ui 等插件。**一般无需修改**即可启动。

### 5.2 MCP 服务器（可选）

若需挂载 stdio MCP 工具：

1. 复制 `mcp-servers.yml.example` → 工作区根 `mcp-servers.yml`
2. 在 `.env` 中填写该文件 `env` 段声明的变量名

详见 [mcp-servers.md](./mcp-servers.md)。

---

## 6. 启动方式概览

```text
┌─────────────────────────────────────────────────────────┐
│  pnpm desktop / pnpm desktop:app                        │
│                                                         │
│  ① ensureHost → Host API  http://127.0.0.1:7331         │
│  ② Vite 开发服          http://127.0.0.1:5173           │
│  ③ （仅 desktop:app）Electron 加载 5173                 │
└─────────────────────────────────────────────────────────┘
```

| 命令 | 说明 |
|------|------|
| `pnpm desktop` | 启动 Host + Vite；用**浏览器**打开 http://127.0.0.1:5173 |
| `pnpm desktop:app` | 同上，并自动打开 **Electron 窗口** |
| `pnpm flint "你好"` | **CLI** 单轮对话（在工作区根执行） |
| `pnpm flint plugin add <路径>` | 向工作区安装本地插件 |
| `tsx apps/host/src/listen.ts` | **仅启动 Host**（不起 Vite，默认端口 7331） |

停止：在终端按 `Ctrl+C`。关闭 Electron 窗口会结束 `desktop:app` 进程。

---

## 7. 浏览器工作台（`pnpm desktop`）

```bash
pnpm desktop
```

终端出现：

```text
➜  Local:   http://127.0.0.1:5173/
```

在浏览器打开上述地址。

### 7.1 工作台布局（侧栏 + 对话 + 文件）

当前 UI 为三栏结构：

```text
┌──────────────┬────────────────────────────┬─────────────────┐
│  左侧边栏     │  中间：对话                 │  右侧：工作空间文件 │
│              │                            │                 │
│  FlintLoom   │  任务标题 + 消息流            │  文件树 / 知识库   │
│  选择工作区   │  底部 composer 输入框         │  文件预览         │
│  新建对话     │                            │                 │
│  对话/插件/   │                            │                 │
│  模型/设置    │                            │                 │
│  任务历史     │                            │                 │
│  主题 / 状态  │                            │                 │
└──────────────┴────────────────────────────┴─────────────────┘
```

| 区域 | 功能 |
|------|------|
| **选择工作区** | 切换到含 `flintloom.yml` 的目录；Electron 下为系统文件夹对话框，浏览器下为路径输入提示 |
| **新建对话** | 创建新 session，当前对话会保存到侧栏「任务」列表 |
| **任务** | 点击历史任务可恢复该会话；列表保存在浏览器 `localStorage` |
| **对话 / 插件 / 模型 / 设置** | 主功能区切换；模型页可跳转到设置 |
| **主题** | 侧栏底部循环切换：浅色 → 深色 → 暖色 |
| **状态** | `host 未连接`、`chat 已配置`、`guard 已配置` 等 pill |
| **消息中的文件卡片** | 助手或工具结果提到工作区文件路径时，会显示可点击卡片，点击后在右侧预览（不写入输入框） |

### 7.2 切换工作区

1. 点击侧栏 **「📁 选择工作区」**。
2. 选择（或输入）目标目录；该目录下必须有 `flintloom.yml`，否则提示无效工作区。
3. 切换成功后会：清空当前对话、刷新右侧文件树、重载模型状态，并将路径写入 `~/.flintloom/workspace`。
4. 若当前有对话进行中，会提示「有对话进行中，请稍后再切换」。

也可在已运行 Host 时通过 API 切换：

```bash
curl -X POST http://127.0.0.1:7331/v1/settings/workspace \
  -H "Authorization: Bearer <hostToken>" \
  -H "Content-Type: application/json" \
  -d "{\"workspaceRoot\":\"G:/path/to/your/project\"}"
```

`hostToken` 位于 `~/.flintloom/credentials` 的 `hostToken` 字段。

**刷新页面**

| 操作 | Windows |
|------|---------|
| 普通刷新 | `Ctrl + R` 或 `F5` |
| 强刷（忽略缓存） | `Ctrl + Shift + R` 或 `Ctrl + F5` |

---

## 8. Electron 桌面（`pnpm desktop:app`）

```bash
pnpm desktop:app
```

脚本会：

1. 确保 Host 在 7331 就绪（若无则启动，若端口被占用且非本进程则报错退出）
2. 启动 Vite（5173），**等待页面可访问后再** spawn Electron
3. 使用独立用户数据目录：`%TEMP%\flintloom-electron`（减轻 Windows 缓存权限问题）

Electron 加载地址由环境变量 `FLINT_DESKTOP_URL` 控制，默认 `http://127.0.0.1:5173`。

侧栏 **「选择工作区」** 在 Electron 下会打开系统原生文件夹选择对话框（比浏览器模式的路径输入更方便）。

### 8.1 打开开发者工具

```powershell
$env:FLINT_ELECTRON_DEVTOOLS = "1"
pnpm desktop:app
```

### 8.2 强刷页面

先点击窗口内容区，再按：

- **强刷**：`Ctrl + Shift + R` 或 `Ctrl + F5`
- **普通刷新**：`Ctrl + R`

或在 DevTools 中右键刷新按钮 → **Empty Cache and Hard Reload**。

### 8.3 清除 Electron 缓存后重启

```powershell
Remove-Item -Recurse -Force "$env:TEMP\flintloom-electron" -ErrorAction SilentlyContinue
pnpm desktop:app
```

### 8.4 为何任务管理器里有多条 `electron`？

一个 Electron 窗口通常对应 **3～4 个进程**（主进程、渲染进程、GPU、工具进程），属于 Chromium 多进程架构，**不一定是重复启动**。若你多次手动开窗口或旧进程未退出，进程数会更多。

---

## 9. CLI 用法

在工作区根目录：

```bash
# 单轮对话
pnpm flint "列出当前目录文件"

# 指定工作区路径
pnpm flint --workspace /path/to/project "你好"

# 安装本地插件到工作区 flintloom.yml
pnpm flint plugin add ../my-plugin --id my-plugin
```

CLI 会读取工作区的 `.env` 与 `flintloom.yml`，与桌面共用同一套 Host 逻辑（CLI 路径不经过 Vite 代理）。

### 9.1 ACP stdio（IDE 集成）

在已配置 `flintloom.yml` 的工作区根目录：

```bash
pnpm flint acp
```

FlintLoom 作为 ACP Agent 通过 stdin/stdout 提供 JSON-RPC；`assistant/chunk` 与工具调用（`tool_call` / `tool_call_update`）会推送到客户端。日志在 stderr。

### 9.2 桌面语音输入

在 `.env` 中配置 DashScope ASR（与 chat 共用 `FLINTLOOM_API_KEY`）后，工作台 composer 会出现「语音」按钮：浏览器录音 → Host `POST /v1/asr` → 转写文本填入输入框。Telegram 语音消息在 ASR 已配置时会自动转写并入站。

配置 TTS 后，助手回复气泡会出现「朗读」按钮；Telegram 出站优先发送语音消息。

### 9.3 图片与 omni 多模态

在 `.env` 中配置 omni（`models-chat` 默认与 chat 共用模型，或单独 `omniModel`）后，工作台 composer 会出现「图片」按钮，可将 JPEG/PNG/GIF/WebP 随 `POST /v1/turns` 发送。session log 的 `user/message` 会带上 `images`，loop 用 `resolveOmni()` 投影为多模态 content。Telegram 图片消息在 omni 已配置时会下载最大尺寸并入站；未配置则忽略（与无 ASR 时忽略语音一致）。

### 9.4 Guard 与 ACP 多模态

配置 API key 后 host 会自动 overlay `@flintloom/models-guard`（可用 `FLINTLOOM_GUARD_MODEL` 覆盖模型名）。工具执行成功后会写 `guard/steward` 事件（可疑结果带 summary），不自动禁用插件。工作台侧栏与 Models 页显示 `chat` / `guard` 是否已配置；Models 页另汇总 asr/tts/omni 等媒体 kind。`flint acp` 会将可疑 steward 附在对应 `tool_call_update` 上转发给 Client。根 `flintloom.yml` 已挂 `channel-telegram` 及 Discord / Slack / 飞书插件行；在 `.env` 或设置页配置对应 token 与 channel/chat id 后，`pnpm desktop` / `startHost` 会自动轮询。Plugins 页说明 `mcp-servers.yml` 自动合并，MCP 行带 `mcp` 标签。`flint acp` 在 omni/asr 已配置时 `initialize` 会声明 image/audio/embeddedContext 能力；`session/prompt` 可带 image 块或 audio 块（音频经 ASR 转写）。

---

## 10. 端口与探测逻辑

| 端口 | 服务 | 说明 |
|------|------|------|
| **7331** | FlintLoom Host | REST + SSE API（`/v1/*`） |
| **5173** | Vite 开发服 | React 工作台；`/v1/*` 由 Vite 代理到 7331 并附带 Bearer Token |

启动时 `ensureHost` 会探测 `http://127.0.0.1:7331/v1/models`：

- 无响应 → 自动 `startHost`
- 带正确 Token 返回 200 → 复用已有 Host
- 端口被其它程序占用 → 报错 **`port 7331 in use`** 并退出

Vite 使用 `strictPort: true`，5173 被占用时会直接失败。

---

## 11. 常见问题

### 页面一片空白（浏览器或 Electron）

1. 打开浏览器 DevTools（`F12`）→ **Console**，查看红色报错。
2. 常见原因：Vite 未就绪、旧进程占端口、前端模块加载失败。
3. 强刷或清 Electron 缓存（见 8.2、8.3）。
4. 确认终端里 Vite 已打印 `Local: http://127.0.0.1:5173/`。

### `Port 5173 is already in use`

已有 `pnpm desktop` 或 `desktop:app` 在运行，或僵尸 node 占端口。

PowerShell 示例（关闭占 5173 / 7331 的 node）：

```powershell
Get-NetTCPConnection -LocalPort 5173,7331 -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique |
  ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
```

然后重新 `pnpm desktop` 或 `pnpm desktop:app`。

### `port 7331 in use`

7331 被非 FlintLoom 进程占用，或旧 Host 的 Token 与当前 `~/.flintloom/credentials` 不一致。先结束占用进程，或换机器上唯一的 Host 实例。

### Electron 安装失败

见第 2 节 `ELECTRON_MIRROR` 与 `install.js` 手动安装。

### Chat 无法发送 / 侧栏未显示「chat 已配置」

检查**当前工作区**目录下的 `.env` 是否配置 `FLINTLOOM_API_KEY`、`FLINTLOOM_BASE_URL`、`FLINTLOOM_CHAT_MODEL`。若刚切换工作区，确认新目录也有 `.env` 或通过设置页配置了 credentials。

### 切换工作区失败

- 目标目录缺少 `flintloom.yml` → 不是有效 FlintLoom 工作区。
- 对话进行中 → 等待当前轮次结束后再切换。
- Host 未连接 → 侧栏显示 `host 未连接`，先确认 7331 端口正常。

### MCP 启动失败

检查 `mcp-servers.yml` 与 `.env` 中声明的环境变量是否齐全。详见 [mcp-servers.md](./mcp-servers.md)。

---

## 12. 开发常用命令

```bash
pnpm test          # 运行全部测试
pnpm typecheck     # TypeScript 检查
```

---

## 13. 相关文档

| 文档 | 内容 |
|------|------|
| [mcp-servers.md](./mcp-servers.md) | MCP 自动配置 |
| [superpowers/specs/2026-08-16-flintloom-workbench-design.md](./superpowers/specs/2026-08-16-flintloom-workbench-design.md) | 工作台与代理设计 |
| [superpowers/specs/2026-08-22-flintloom-desktop-electron-design.md](./superpowers/specs/2026-08-22-flintloom-desktop-electron-design.md) | Electron 薄壳设计 |
