# MCP 服务器配置

FlintLoom 可在工作台 **插件** 页管理 stdio MCP 服务器，也会通过 **`mcp-servers.yml`** 自动挂载服务器，无需在 `flintloom.yml` 里手写 MCP 行。

启动时（`pnpm desktop`、`flint`、host）会：

1. 读取个人目录与工作区的 `mcp-servers.yml`
2. 把工作区 `.env` 里**已声明**的环境变量名填入子进程（不含 `FLINTLOOM_*`）
3. 为每个已启用的 server spawn 子进程、登记工具 `mcp__<id>__<工具名>`

仍可在 `flintloom.yml` 里手动写 MCP 行；**同一 `id` 以 `flintloom.yml` 为准**，自动文件不会覆盖。

---

## 在插件页管理

工作台 **插件** 页可以添加、编辑、删除和开关工作区 MCP 服务器，操作会写入工作区的 `mcp-servers.yml`。个人目录中的服务器会显示为只读条目；需要修改时，先将它复制到工作区。

`mcp-servers.yml` 始终是配置真相。直接手改文件后，请在插件页点击「重载 host」使配置生效。

如果在对话进行中保存配置，YAML 仍会写入，但页面会提示等待对话结束后再点击「重载 host」。

---

## 配置文件位置

| 位置 | 路径 | 作用 |
|------|------|------|
| 工作区（优先） | `<工作区>/mcp-servers.yml` | 项目级 MCP，覆盖个人同名 `id` |
| 个人 | `~/.flintloom/mcp-servers.yml` | 全局默认 MCP |

两个文件可以只配一个。文件不存在则跳过，不影响启动。

---

## 文件格式

```yaml
servers:
  - id: fake          # 服务器名，须符合插件 id 规则（字母数字、_-）
    command: node     # 启动命令
    # enabled: false  # 可选；省略表示启用
    args:             # 可选，默认 []
      - packages/mcp/fixtures/fake-mcp-server.mjs
    env:              # 可选，传给子进程的环境变量**名**（不是值）
      - FAKE_TOKEN
```

字段说明：

- **`id`**：工具名前缀，例如 `mcp__fake__echo`
- **`command`** / **`args`**：与手动 `flintloom.yml` 相同
- **`env`**：子进程需要的环境变量名列表；值来自工作区 `.env` 或当前进程的 `process.env`
- **`enabled`**：可选；`false` 表示关闭，关闭的 server 不启动子进程，也不登记工具。启用时省略该键，不写 `enabled: true`
- **不会**把 `FLINTLOOM_*` 传给 MCP 子进程

---

## 环境变量怎么填

在**工作区根目录** `.env` 中写声明过的名字（推荐）：

```env
FAKE_TOKEN=my-secret-token
GITHUB_TOKEN=ghp_xxx
```

或使用系统环境变量（PowerShell 示例）：

```powershell
$env:FAKE_TOKEN = "my-secret-token"
```

缺任一声明名 → 该 server 启动失败，错误信息只含变量**名**，不含值；其它 MCP、插件和聊天仍可用。

---

## 示例：仓内假 server（测试）

1. 在工作区根创建 `mcp-servers.yml`：

```yaml
servers:
  - id: fake
    command: node
    args:
      - packages/mcp/fixtures/fake-mcp-server.mjs
    env:
      - FAKE_TOKEN
```

2. 在工作区 `.env` 添加：

```env
FAKE_TOKEN=demo-token
```

3. 启动 host / desktop，Agent 工具列表应出现 `mcp__fake__echo`。

4. 调用示例参数：`{ "text": "hello" }`，返回 `hello`。

仓库内可复制 `mcp-servers.yml.example` 为 `mcp-servers.yml` 并按需修改。

---

## 示例：真实 MCP server

以 Node 编写的 MCP 包为例（具体以该包文档为准）：

```yaml
servers:
  - id: github
    command: npx
    args:
      - -y
      - "@modelcontextprotocol/server-github"
    env:
      - GITHUB_TOKEN
```

`.env`：

```env
GITHUB_TOKEN=ghp_你的令牌
```

注意：本片只支持 **stdio + tools**；HTTP/SSE MCP 暂不支持。

---

## 与 `flintloom.yml` 手动配置对比

| 方式 | 适用场景 |
|------|----------|
| **`mcp-servers.yml`（自动）** | 日常开发、多 server、密钥放 `.env` |
| **`flintloom.yml` 手写行** | 与组装强绑定、或需精细 overlay |

手动行格式（仍可用）：

```yaml
plugins:
  - id: fake
    name: "@flintloom/mcp"
    config:
      command: node
      args: [path/to/server.mjs]
      env: [FAKE_TOKEN]
```

---

## 故障排查

| 现象 | 可能原因 |
|------|----------|
| 没有 `mcp__` 工具 | 无 `mcp-servers.yml`、server 已关闭，或 `id` 已在 `flintloom.yml` 占用但未配 MCP |
| 插件页该行标红并显示 `missing env: XXX` | `.env` / 环境变量未设置声明名；仅该 server 失败 |
| 插件页该行标红并显示 `command` / `id` 错误 | YAML 字段错误或 `id` 不合法；仅该 server 失败 |
| 插件页该行标红并显示 initialize 超时 | server 脚本路径错误，或进程未按 MCP stdio 协议响应；仅该 server 失败 |

子进程 `cwd` 为工作区根目录（`workspaceRoot`），由运行时自动注入。

单台 MCP 启动失败不会阻止 host、其它插件或其它 MCP 启动；失败行不登记工具，聊天仍可使用。

---

## 安全说明

- 子进程环境：OS 基线变量 + 你在 `env` 里声明的名字
- **`FLINTLOOM_*` 永不传入 MCP 子进程**
- 失败日志不含 token、密钥或 env 值
