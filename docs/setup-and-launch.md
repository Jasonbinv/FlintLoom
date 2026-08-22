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

**工作区根目录**：你运行 `pnpm desktop`、`pnpm flint` 时所在的目录（`process.cwd()`）。Host 会把该目录当作 agent 工作区，并从这里读取 `flintloom.yml`、`.env`、`mcp-servers.yml`。

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

4. 配置成功后，工作台顶栏会显示 **「chat 已配置」**；未配置时聊天不可用。

DeepSeek 等其它厂商可参考 `.env.example` 中的注释切换 `BASE_URL` 与 `CHAT_MODEL`。

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

### Chat 无法发送 / 顶栏未显示「chat 已配置」

检查工作区 `.env` 是否配置 `FLINTLOOM_API_KEY`、`FLINTLOOM_BASE_URL`、`FLINTLOOM_CHAT_MODEL`。

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
