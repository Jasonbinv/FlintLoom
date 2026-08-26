# FlintLoom 工作区文件树磁盘同步

日期：2026-08-27  
状态：待审阅草稿  
产品：FlintLoom — A real agent. / 真正的 Agent。  
范围：工作区文件树与磁盘对齐。Agent 写入与资源管理器拷贝同等对待。不引入 SSE、不引入 chokidar、不改 `runTurn`。

## 1. 这是什么

文件树今天只在打开、展开、以及界面内增删改移时拉列表。磁盘上新出现的文件（对话工具写出、外面拷进来）不会出现，除非点刷新。

本片让 Host 监听当前工作区，桌面用长轮询拿到变化后，只重拉**已展开**且受影响的目录。标题栏 ↻ 保留为兜底。

验收：工作区根下新增一个可见文件（不经过文件树菜单），不超过约一秒，树里出现该文件，无需点刷新。自动化测试不依赖真实 API key。

## 2. 复核后收紧的决策

| 点 | 决定 |
|---|---|
| 谁听盘 | Host 对 `workspaceRootRef.current` 做 `fs.watch({ recursive: true })`。不引入 `chokidar`。 |
| 谁通知 | `GET /v1/files/sync?generation=<n>` 长轮询。不要 SSE、不要 400ms 空转短轮询。 |
| 鉴权 | 与其它 `/v1/files*` 相同：Bearer。缺 token → 401。 |
| 路由顺序 | 先匹配 `/v1/files/sync`，再匹配 `/v1/files`，避免被前缀吃掉。 |
| `generation` | 非负整数。Host 启动或切换工作区后从 **0** 起。每次**可见**变化 +1。非法或缺省 → HTTP 400。 |
| 客户端落后 | `n < current` 或 `n > current`：立刻 200，`dirs` 含 `"."`，`files` 为空。表示错过事件，桌面刷新**全部已展开**目录（含根）。 |
| 客户端对齐 | `n === current`：挂起直到可见变化或超时。 |
| 超时 | **20s**。超时 200：`{ generation: current, dirs: [], files: [] }`。客户端立刻再挂。 |
| 变化去抖 | **300ms**。窗口内的路径合并进同一代。 |
| 脏路径 | 每个可见变化的相对路径，把它自己（若是文件则其父目录）以及所有祖先（含 `"."`）记入 `dirs`（正斜杠，根为 `"."`）。变化的文件相对路径记入 `files`。 |
| 唤醒后 | 把这一代的 `dirs`/`files` 发给所有等待者，然后清空脏集。 |
| 忽略 | `isHiddenRelPath` 为真的路径；basename 以 `~$` 开头（Office 锁）。忽略的事件不 bump generation。 |
| 监听失败 | watch 启动失败或 error：不崩溃。sync 仍可挂起到超时并返回空 dirs。↻ 仍可用。 |
| 切换工作区 | `workspaceRootRef` 更新后关掉旧 watcher，`generation` 归 0，清空脏集，对新根再 watch。桌面已有 `filePaneKey` 会卸挂 FilePane，新实例从 `generation=0` 再挂。 |
| 请求取消 | `req`/`res` `close` 时结束等待，不再 `writeHead`。 |
| 桌面循环 | FilePane 挂载后循环 `fetchFilesSync(generation)`；`AbortController` 在卸载时 abort。不要在知识库 tab 停循环（循环很便宜）。 |
| 应用变化 | 若本次是 **catch-up**（请求的 `n !==` 响应 `generation`，且 `files` 为空、`dirs` 为 `["."]`）：刷新根 + 所有已展开目录。否则只对 `dirs` 里 `"."` 或已展开的目录 `reloadDir`。`files` 含当前 `selectedFile` 则 `startPreview`。不自动展开折叠目录，不自动选中新文件。 |
| 预览 | 仅当选中文件出现在本次 `files`，或发生 catch-up 时刷新预览。超时空包不刷新预览。 |
| 手动刷新 | ↻ 与右键「刷新」行为不变：立刻 `reloadDir` 已展开树，不经过 sync。 |
| 代理 | 长轮询是**完整 JSON 一次性结束**，沿用现有 Vite `forwardV1`。不要为本片改 Range 头。超时 20s 低于常见 30s 空闲断开。 |

## 3. 非目标

- SSE / WebSocket / EventSource
- `chokidar`、完整 `.gitignore` 引擎
- 自动展开新文件夹、自动打开新文件
- 知识库列表随磁盘变（本片只文件树）
- 跨工作区通知、多窗口 generation 历史回放（落后即整树可见刷新）
- 改 `runTurn`、改 CORS、把 token 送进页面

## 4. 架构

```text
Host
  watch(workspaceRoot, recursive)
    → 忽略隐藏 / ~$*
    → 300ms debounce
    → generation++，记录 dirs + files，唤醒等待者

Desktop FilePane
  GET /v1/files          初次列表
  loop:
    GET /v1/files/sync?generation=N   （对齐则等 ≤20s）
    reload 受影响且已展开的目录
    必要时刷新当前预览
  ↻ 仍直接 GET /v1/files
```

JSON（200）：

```json
{ "generation": 4, "dirs": [".", "md"], "files": ["md/notes.md"] }
```

`dirs` / `files` 去重；根永远是 `"."`，不要 `""`。

## 5. 组件

| 处 | 职责 |
|---|---|
| `apps/host/src/fileWatch.ts`（新） | watch / debounce / generation / wait(n, signal) / 切换根 |
| `apps/host/src/server.ts` | `GET /v1/files/sync`；`startHost`/`setWorkspace` 接到 watch 生命周期 |
| `apps/desktop/src/files.ts` | `fetchFilesSync(generation, signal)` |
| `apps/desktop/src/FilePane.tsx` | 挂载循环；按 dirs/files 增量 reload |

`wait(n, signal)`：若 `n !== current` 立即返回 catch-up；否则登记 waiter，signal abort 或 20s 或 bump 时结束。

## 6. 测试

Host（真实临时目录 + `startHost`）：

- 对齐 generation 时写入可见文件 → sync 在 20s 内 200，`generation` 增加，`dirs` 含 `"."`，`files` 含该文件。
- 对齐 generation 且无变化 → 约 20s 后 200，generation 不变，`dirs`/`files` 空。
- 写入 `.env` 或 `~$foo.docx` → 等待超时，generation 不变。
- 缺 Bearer → 401。
- `n` 落后于 current → 立刻 200，`dirs` 含 `"."`。

Desktop：

- FilePane 在 listing 之后会请求 `/v1/files/sync`。
- sync 返回新根文件名时，树中出现该文件（mock fetch）。

## 7. 失败与降级

| 情况 | 行为 |
|---|---|
| watch 不可用 | sync 只超时空包；树不自动变；↻ 仍工作 |
| sync 网络失败 | 桌面等 1s 再挂，不打爆循环 |
| 长轮询被 abort | 静默；卸载时预期发生 |
| 选中文件已删 | 现有 preview 失败态即可，不另做撤销选中 |

手动 ↻ 不依赖 watch。
