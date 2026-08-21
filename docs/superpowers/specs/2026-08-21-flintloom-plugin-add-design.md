# FlintLoom `flint plugin add` 切片设计

日期：2026-08-21  
状态：待审阅  
产品：FlintLoom — A real agent. / 真正的 Agent。  
范围：总 spec 第四刀的 **安装器**：`flint plugin add [--id <id>] <path>` 把本地目录拷进 profile，验证入口有 `apply`，再在工作区 `flintloom.yml` 末尾加一行。组装机制已在 1.5 刀存在。本片只做 **本地 path**；`name` 写成 profile 内**绝对路径**；`applyConfig` 对绝对路径走 file URL `import`。

## 1. 这是什么

用户有一个带 `apply` 的 Loom 插件目录。在工作区里执行 `flint plugin add <path>` 后，该目录的拷贝出现在 `~/.flintloom/plugins/<id>`，工作区 `flintloom.yml` 多一行，下次 `createRuntime` / host 会按绝对路径加载它。不经过聊天、不经过 HTTP、不 `runTurn`。

验收：临时目录里一个只有 `index.js`（default export `{ name, apply }`）的插件，`installPluginFromPath` 之后 yml 含该 `id`，`name` 为 profile 绝对路径；`applyConfig` 用默认 `importFn` 能挂上该插件。yml 已有该 `id`、或 profile 目标目录已存在、或入口没有 `apply` → 拒绝，yml 与 profile 目标目录都不留下成功安装的痕迹。`flint plugin add` **不**调用 `createRuntime`。自动化测试不依赖真实 API key、不访问网络。

## 2. 收紧的决策

| 点 | 决定 |
|---|---|
| 安装源 | **只**本地 path。git clone、npm 拉包不在本片。 |
| 命令 | `flint [--workspace <dir>] plugin add [--id <id>] <path>`。识别到 `plugin add` 后走安装器，**禁止** `createRuntime` / `runTurn`。 |
| 工作区 | `--workspace` 与现网 CLI 相同：决定读哪份 `flintloom.yml`。缺省 `process.cwd()`。 |
| Profile | `join(homeDir, ".flintloom", "plugins", id)`。CLI 的 `homeDir` 是 `os.homedir()`。可测 API 注入 `homeDir`。 |
| `id` | 默认 `path.basename(realpath(source))`。`--id` 覆盖。不能为空、不能是 `.` / `..`、不能含 `/` 或 `\`。 |
| Bundle | **目录**（不是单文件）。不要求 `package.json`。必须解析到可 `import` 的入口，且 `unwrapPlugin` 成功。 |
| 验证 | 先拷到同级临时目录 → import + `unwrapPlugin` → 成功再 `rename` 到目标并写 yml。失败删除临时目录，不写 yml，不创建目标目录。 |
| 重复 | 该工作区 yml **已有相同 `id`**，或目标 profile 目录 **已存在** → 拒绝，不覆盖。 |
| yml `name` | 目标目录的绝对路径（`realpath` 在 rename 之后）。不写 `plugin:` 前缀，不靠改 Node 模块搜索路径。 |
| 相对路径 `name` | 本片 **不**写相对路径。`applyConfig` 只对 `path.isAbsolute(name)` 走文件 import；包名仍 `import(name)`。 |
| 拷贝过滤 | 递归拷贝；名为 `node_modules` 或 `.git` 的目录 **不拷**。本片不在目标里跑 `pnpm install`。带第三方依赖且解析不到的插件，验证阶段失败。 |
| yml 写入 | 用 `yaml` `parseDocument`，在 `plugins` 序列 **末尾**追加 `{ id, name }`，不写 `config`。写回前用 `loadConfig` 校验 dump 结果。 |
| 成功输出 | stdout 一行 `added <id>\n`，exit 0。 |
| 第二工作区 | 同一 `homeDir` 下同一 `id` 的 profile 目录已存在时，`add` 拒绝。另一工作区若要挂同一拷贝，**手写**同一绝对路径到那份 yml；本片不提供「复用已有 profile」。 |
| 破坏性 | 现网 `flint plugin add …` 会把整段当聊天文本。本片之后这是子命令，不再开 turn。 |

## 3. 非目标

- `flint plugin add <git-url>`、`flint plugin add <npm-name>`
- `flint plugin list` / `remove` / `disable`
- 工作台插件列表页、模型页、Electron
- Host 安装 HTTP API；模型 / 工具 / 聊天里安装代码
- 市场后台、从 URL 下载
- yml `name` 为 `./相对路径` 或 `plugin:<id>`
- 安装时执行 `pnpm install` / `npm install`
- 把 `config` 从某处拷进 yml
- 改仓库根默认 `flintloom.yml` 插件列表、改 `ASSEMBLY`
- MCP、skill、通道、`channels.send`
- Vendor Cordis / dataagent-v3 / deepseek-harness

## 4. 架构

```text
flint [--workspace W] plugin add [--id ID] SRC
        │
        ▼
installPluginFromPath({ workspaceRoot, homeDir, sourcePath, id? })
        │
        ├─ 读 W/flintloom.yml（缺/坏 → 抛错）
        ├─ 校验 id；yml 已有 id 或 dest 已存在 → 抛错
        ├─ cp SRC → plugins/.${id}.tmp-<hex>（排除 node_modules / .git）
        ├─ resolvePluginEntry(tmp) → import(file URL) → unwrapPlugin
        ├─ rename tmp → plugins/<id>
        └─ Document 追加 plugins 行；loadConfig 校验后写回 yml

createRuntime / applyConfig（下次开机）
        │
        └─ row.name 若 path.isAbsolute → import(pathToFileURL(entry).href)
           否则 import(name)   // @flintloom/* 等包名
```

### 4.1 代码放哪

| 单位 | 职责 |
|---|---|
| `@flintloom/kernel` | `resolvePluginEntry`、`defaultImport`（`applyConfig` 缺省 `importFn`）、`installPluginFromPath`（返回 `{ id, dest }`，**不**写 stdout）、`unwrapPlugin`（已有） |
| `apps/cli` | argv：`--workspace` 全局；若剩余参数以 `plugin add` 开头则调 `installPluginFromPath`，否则保持现网 `createRuntime` + `runTurn` |
| `apps/host` | **不**新增路由，**不**调用安装器 |

CLI 直接依赖 `@flintloom/kernel`（现为 host 的传递依赖；本片改为 CLI `package.json` 声明）。

禁止新 Loom 包。禁止往 `createRuntime` 里 `register`。

### 4.2 入口解析 `resolvePluginEntry(dir)`

`dir` 必须是目录。按以下顺序取**第一个存在的文件**（均为相对 `dir` 的路径，存在则 `realpath`）：

1. 若 `package.json` 存在且为对象：`main` 为非空字符串则尝试该相对路径；否则 `module` 为非空字符串则尝试。不解析 `exports` 条件图。相对路径含 `..` 逃出 `dir` → 当作无此入口，继续往下。
2. `index.js`
3. `index.mjs`
4. `index.ts`

都没有 → 抛错，消息含 `entry`。

当前 `flint` / 测试经 `tsx` 加载，`.ts` 入口可以 `import`。本片不另做 TS 编译器。

`applyConfig` 遇到绝对路径时：若该路径是目录，先 `resolvePluginEntry`；若是文件，直接对该文件 `import`。安装器只接受**源为目录**，yml 写入的 `name` 是**目录**的绝对路径。

### 4.3 默认 `importFn`

```text
if (path.isAbsolute(name)) {
  const spec = isDirectory(name) ? resolvePluginEntry(name) : name
  return import(pathToFileURL(spec).href)
}
return import(name)
```

包名（含 `@flintloom/fs`）不是绝对路径，行为与现网相同。现有测试传入自定义 `importFn` 的用例不受影响。

Windows 与 POSIX 都用 `path.isAbsolute` + `pathToFileURL`。yml 里的 `name` 按 `yaml` 序列化规则引号转义，读回后仍是绝对路径字符串。

### 4.4 安装流程（必须按此顺序）

1. `sourcePath` 经 `realpath`：不存在或不是目录 → 抛错，消息含 `path`。
2. `id`：`--id` 或 `basename(source)`。非法 → 抛错，消息含 `id`。
3. 读 `{workspaceRoot}/flintloom.yml`。缺失或 `loadConfig` 失败 → 与开机相同，消息含 `plugins` 或路径。
4. `config.plugins` 已有该 `id` → 抛错，消息含 `id`。不改任何文件。
5. `dest = join(homeDir, ".flintloom", "plugins", id)`。`dest` 已存在（文件或目录）→ 抛错，消息含 `id`。不改 yml。
6. `mkdir` `join(homeDir, ".flintloom", "plugins")`。
7. `tmp = join(parent, `.${id}.tmp-${hex}`)`，`hex` 为 8 字节 `randomBytes` 的 hex。`fs.cpSync(source, tmp, { recursive: true, filter })`。`filter`：路径 basename 为 `node_modules` 或 `.git` 则跳过该目录。
8. `import` tmp 的入口，`unwrapPlugin`。失败 → `rm(tmp, { recursive })`，抛错（无 `apply` 时消息含用于 unwrap 的 name/路径；与现网 `unwrapPlugin` 一致，含 `name` 或路径，**不含**文件全文）。
9. `rename(tmp, dest)`。若 `rename` 失败 → `rm(tmp)`（若仍在），抛错。
10. 用 `parseDocument` 打开**原** yml 文本，向 `plugins` 追加 YAML map：`id`、`name`（`realpath(dest)`）。`plugins` 不是序列 → 抛错 `plugins`，并 `rm(dest)`。
11. `doc.toString()` 后 `loadConfig`；失败则 `rm(dest)`，不覆盖 yml。
12. 将 dump **原子写回** yml（写临时文件再 rename 到 `flintloom.yml`）。写回失败 → `rm(dest)`，尽量恢复原 yml（rename 失败则原文件应仍在）。

临时目录在任何失败路径上都要删掉。崩溃留下的 `.*.tmp-*` 不算已安装；不阻挡下次 `add`（目标 `dest` 仍不存在即可）。

`fs.cpSync` 不跟随拷贝源目录外的符号链接目标作为独立树（保持 Node 默认：拷贝 symlink 本身）。本片不对 symlink 再加白名单。

## 5. CLI

现网：`flint [--workspace <dir>] <text…>` 开一轮 CLI turn。

本片：先抽出所有 `--workspace <dir>`（与现网相同，可出现在任意位置）。剩余 argv：

| 剩余 argv | 行为 |
|---|---|
| `plugin` `add` … | 安装器。再解析可选 `--id <id>` 与恰好一个 path。多余位置参数 → 抛错，消息含 `path`。缺 path → 抛错，消息含 `path`。`--id` 出现在 `plugin add` 段内。 |
| `plugin`（无 `add`） | 抛错，消息含 `plugin add`。不实现 `list`/`remove`。 |
| 其它（含空） | 现网 turn：空 text 仍走 `runTurn`（与现网一致，不在本片改语义）。 |

`--id` **只**在 `plugin add` 段解析。聊天文本里的 `--id` 若出现在未进入子命令的 argv 中，现网会进 `--workspace` 扫描循环：本片 **不要**把 `--id` 做成全局 flag，以免吃掉聊天词。

成功：`process.stdout.write("added " + id + "\n")`，`process.exit(0)`。失败：stderr 写 `err.message`（若是 `Error`），`process.exit(1)`。不调用 `createRuntime`。

## 6. 错误处理

| 失败 | `Error.message` 含 | 副作用 |
|---|---|---|
| 源不存在 / 不是目录 | `path` | 无 |
| `id` 非法 | `id` | 无 |
| 无 / 坏 `flintloom.yml` | `plugins` 或 yml 路径 | 无 |
| yml 已有该 `id` | `id` | 无 |
| `dest` 已存在 | `id` | 无 |
| 无入口文件 | `entry` | 无 dest、无 yml 改动（tmp 已删） |
| 无 `apply` / unwrap 失败 | 入口路径或 `name`（与 `unwrapPlugin` 现网） | 同上 |
| yml dump 无法 `loadConfig` 或写回失败 | `plugins` 或路径 | 删除 dest；yml 保持安装前内容 |

消息**不得**包含 API key、host token、或把整个插件源码塞进 `Error.message`。

验证阶段只 `import` + `unwrapPlugin`，**不** `new Context()`、**不**调用 `apply`。`apply` 是函数即通过。`import` 仍会执行模块顶层；本片不隔离顶层副作用。

## 7. 测试

全部不依赖真实 API key、不访问网络。

1. **kernel `applyConfig`：** yml `name` 为绝对路径目录（含 `index.js` default `apply`），不传自定义 `importFn`，boot 后能 `require` 该插件 `provide` 的键（测试插件 `provide("plugin-add-test", 1)`）。
2. **kernel `applyConfig`：** `name: "@flintloom/models"` 这类包名行为不变（现有用例仍绿）。
3. **`installPluginFromPath`：** 成功 → dest 存在、yml 末行 `id`/`name` 正确、`name` 为绝对路径、stdout 契约由 CLI 测。
4. **重复 `id`：** 第二次失败；dest 内容与 yml 与第一次之后相同。
5. **dest 已存在而 yml 无该 id：** 失败；yml 不变。
6. **无 `apply` 的 `index.js`：** 失败；yml 不变；`plugins/<id>` 不存在；无残留 tmp。
7. **无入口：** 失败，消息含 `entry`。
8. **CLI：** `plugin add` 路径不调用 `createRuntime`（测纯函数 `parseCliArgv` / 安装分支，或对 `installPluginFromPath` mock）。聊天路径仍解析 `--workspace` + text。
9. **`id` 含 `..` 或 `/`：** 失败，消息含 `id`。

过滤：源树含 `node_modules/ignored.js` 时，拷贝后 dest 无 `node_modules`。

## 8. 对已有切片的影响

- **插件组装：** `name` 仍优先是可被 Node 解析的包名。本片 **追加**绝对路径一种 `name`。相对路径仍不支持。
- **Host / 桌面 / 通道 / DocForge / A2UI：** 不改行为。默认装配列表不变。
- **CLI：** 仅增加子命令分支；非 `plugin add` 的 turn 语义不变。
- **安全（总 spec §12）：** 自定义插件仍只从显式 `plugin add` 或手写 yml 路径加载。本片不提供聊天安装。

## 9. 实现顺序（本刀内）

1. Kernel：`resolvePluginEntry`、默认路径 `importFn`、`applyConfig` 测试。
2. Kernel：`installPluginFromPath` + 安装测试。
3. CLI：argv 分支、依赖 kernel、CLI 测试。
4. 全量 `pnpm test` / `pnpm typecheck` 保持绿。
