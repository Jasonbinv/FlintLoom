# FlintLoom Skill 切片设计

日期：2026-08-22  
状态：已审阅  
产品：FlintLoom — A real agent. / 真正的 Agent。  
范围：总 spec 第 5 刀：**本地 skill 目录 + `skill` 工具**。从出生就是插件。不改 `runTurn`，不加 HTTP，不加桌面页。

## 1. 这是什么

用户把 skill 写成 `<id>/SKILL.md`，放在个人目录或当前工作区。Agent 用唯一工具 `skill`（`action: list | read`）发现并读取。每次调用现扫盘；同 id 时工作区覆盖个人。正文只经现有 `tool/call` + `tool/result` 进 session，再进 prompt。

验收：临时 `homeDir` 与工作区各有合法 skill；同 id 时 `list`/`read` 只出工作区且 `source: "workspace"`。yml 去掉 `skill` 行后 schema 无该工具。`flint` 假 chat 一轮仍绿。自动化测试不依赖真实 API key，不写开发者真·家目录。

## 2. 收紧的决策

| 点 | 决定 |
|---|---|
| 目录 | 个人 `join(homeDir, ".flintloom", "skills")` + 工作区 `join(workspaceRoot, "skills")`。只认一层子目录。 |
| 覆盖 | **按目录 id**：工作区只要存在该 id **子目录**，个人同名不再出现。目录里没有合法 `SKILL.md` → 不进 `list`；`read` 为 `failed: not found`（缺文件）或 `failed: bad skill`（坏文件）。 |
| 模型侧 | 只走 `skill` 工具。不改 `runTurn`，不注入系统提示。 |
| 正文进 prompt | 复用 `tool/result`。不加 `skill/body` 事件。 |
| 文件 | `<id>/SKILL.md`。YAML 头只要 `name`、`description`（trim 后非空 string）；其余键忽略。正文是头之后的 markdown。 |
| `id` | 目录名，规则与 `isPluginId` 相同。隐藏名（`isHiddenRelPath(id)`）跳过。 |
| `homeDir` | 插件 `config.homeDir`；缺省 `os.homedir()`。host / CLI 经 `runtimeConfigById.skill = { homeDir }` 覆盖（与 knowledge 的 `dbPath` 同套路）。 |
| `workspaceRoot` | 只来自这次 `exec.workspaceRoot`，不在 `apply` 冻住。 |
| 扫盘 | 每次 `execute`。不创建缺失目录。不提供 `ctx.skill`。 |
| 上限 | `stat.size > 800_000` 或正文 `.length > 200_000` → `failed: too large`，不截断。`name` > 80 或 `description` > 500 → `failed: bad skill`。 |
| 编码 | UTF-8。去掉 BOM。头分隔认 `\r?\n`。 |
| 其它文件 | 目录里脚本/资源不读、不执行。 |
| 工具参数 | **禁止**名为 `path` 的参数（`ToolRegistry.execute` 会对 string `path` 做 `resolveInside`）。 |
| 工作区逃逸 | 工作区文件用 `resolveInside(workspaceRoot, "skills/<id>/SKILL.md")`。越界 → `failed: not found`，消息不含绝对路径。个人目录不走 `resolveInside`。 |
| `fs` | 本片不拦 `fs` 读 `skills/`。模型可见的 skill 正文以 `skill` 的 `tool/result` 为准。 |
| 失败文案 | 一律 `failed: …` 或 `aborted`。不得含 API key / host token / 绝对 `homeDir` / 插件源码。 |

## 3. 非目标

- HTTP、桌面 Skill 页、插件列表页、模型页
- `skill` 写入/安装/删除；执行 skill 脚本
- 自动把描述或正文注入系统提示
- MCP、`channels.send`、guard `ask`、A2UI table/chart
- 改 `runTurn`、往 `createRuntime` 里 `register`
- 引入 / vendor Cordis、dataagent-v3、deepseek-harness

## 4. 架构

```text
flintloom.yml  … → tools → … → skill → loop

@flintloom/skill
  apply(ctx, config)
    require("tools")
    homeDir = config.homeDir || os.homedir()
    effect(tools.register(createSkillTool({ homeDir })))

每次 execute 现扫：
  home      join(homeDir, ".flintloom", "skills", <id>, "SKILL.md")
  workspace resolveInside(workspaceRoot, "skills/<id>/SKILL.md")
            （工作区存在 <id>/ 则丢掉个人同名）
```

host **不** `import @flintloom/skill`。只 overlay `homeDir`。根 `package.json` 把 `@flintloom/skill` 列为 `devDependencies`，供 `import(name)` 从仓库根解析。

yml 在 `loop` **之前**加一行：

```yaml
  - id: skill
    name: "@flintloom/skill"
```

仓库根 `flintloom.yml` 与 host 测试 `ASSEMBLY` 都加。去掉该行 → 启动成功，schema 无 `skill`。桌面默认工作区若是仓外的 `workspaces/demo`，那份 yml 自行加同一行才会在 `pnpm desktop` 里出现该工具；本仓不把它当交付物。

## 5. 组件

### 5.1 `parseSkillMarkdown(raw: string)`

1. 去掉 BOM。  
2. 必须匹配 `^---\r?\n([\s\S]*?)\r?\n---\r?\n?`，否则抛 `bad skill`。  
3. 用 `yaml.parse` 解析捕获组。结果必须是普通对象。  
4. `name`、`description` 必须是 string，trim 后非空，且分别 ≤ 80 / 500。  
5. 返回 `{ name, description, body }`。`body` 是第二道 `---` 之后的原文，不 trim。

### 5.2 `scanSkills({ homeDir, workspaceRoot })`

返回 `SkillRecord[]`，按 `id` 做 `localeCompare` 排序。

```ts
type SkillSource = "home" | "workspace";

type SkillRecord = {
  id: string;
  name: string;
  description: string;
  source: SkillSource;
  body: string;
};
```

扫描一层 `readdir`。跳过非目录、`!isPluginId(name)`、`isHiddenRelPath(name)`。  
先填个人合法项。再扫工作区：每个合格子目录先 `delete(id)`，再尝试读 `SKILL.md`（经 `resolveInside`）；合法则写入 `source: "workspace"`。  
缺根目录、缺文件、坏 YAML、超大、越界 → 该 id 不进结果（工作区目录仍已覆盖掉个人项）。

`lookupSkill({ homeDir, workspaceRoot, id })` 给 `read` 用：工作区存在该 id 子目录时只查工作区（缺文件 `not found`，坏文件 `bad skill`，超大 `too large`，越界 `not found`），绝不回落个人。否则查个人。两边都没有 → `not found`。

```ts
type SkillLookup =
  | { ok: true; record: SkillRecord }
  | { ok: false; reason: "not found" | "bad skill" | "too large" };
```

### 5.3 工具 `skill`

```ts
createSkillTool({ homeDir: string }): ToolDefinition
```

| 字段 | 值 |
|---|---|
| `name` | `skill` |
| `description` | `List or read local skills. Use action list, or action read with id.` |
| `parameters` | `{ type: "object", properties: { action: { type: "string", enum: ["list", "read"] }, id: { type: "string" } }, required: ["action"] }` |

| `action` | 行为 |
|---|---|
| `list` | 忽略 `id`。返回 `JSON.stringify({ skills: records.map(({ body: _b, ...rest }) => rest) })`。 |
| `read` | `id` 必须 `isPluginId`。命中返回 `JSON.stringify({ id, name, description, source, body })`。 |

| 失败 | 返回 |
|---|---|
| 缺 `action` 或不是 string | `failed: missing action` |
| `action` 不是 `list`/`read` | `failed: unknown action` |
| `read` 且 `id` 不是合法 `isPluginId` | `failed: missing id` |
| `read` 扫不到合法记录 | `failed: not found` |
| `read` 工作区目录在、文件坏 | `failed: bad skill` |
| `read` 超大 | `failed: too large` |
| `exec.signal.aborted` | `aborted` |

`list` 的项不含 `body`。`read` 在工作区目录覆盖了个人、但文件坏/缺时，不得回落到个人那份。

### 5.4 插件 `apply`

```ts
{
  name: "@flintloom/skill",
  apply(ctx, config) {
    const tools = ctx.require<ToolRegistry>("tools");
    const homeDir =
      typeof config.homeDir === "string" && config.homeDir.length > 0
        ? config.homeDir
        : homedir();
    ctx.effect(tools.register(createSkillTool({ homeDir })));
  },
}
```

不 `provide`。yml 有 `skill`、无 `tools` → 拒绝启动。dispose 后 schema 无 `skill`，`execute("skill")` 抛 `Tool not registered`。

## 6. 错误处理

| 情况 | 行为 |
|---|---|
| yml 无 `skill` | 启动成功；schema 无 `skill`；overlay `homeDir` 闲置无害 |
| yml 有 `skill`、无 `tools` | `require("tools")` 拒绝启动 |
| 两处 `skills/` 都不存在 | `list` → `{"skills":[]}` |
| 工作区与个人同 id | 只见工作区；坏/缺工作区文件不回落个人 |
| `fs` 读同一文件 | 现网 `fs` 行为不变 |

## 7. 测试

不依赖真实 API key。文件只写临时目录。

1. `parseSkillMarkdown`：合法头、CRLF、BOM、缺头、坏 YAML、空 name、超长 description。  
2. `scanSkills`：个人 + 工作区合并；同 id 工作区覆盖；工作区空目录挡住个人；隐藏 id 跳过。  
3. `skill` 工具：`list`/`read` JSON、失败文案、`aborted`、返回值不含绝对 `homeDir`。  
4. 插件：登记与 dispose。  
5. `createRuntime` + `ASSEMBLY`：schema 含 `skill`；去掉该行则无。  
6. `apps/host/src` 扫描不得出现 `@flintloom/skill`、`createSkillTool`。  
7. `pnpm test` 与 `pnpm typecheck` 全绿。

## 8. 总 spec 对接

- 第 5 节 `packages/skill`：本片落地。  
- 「模型看见的必须先记进 log」：skill 正文走 `tool/result`。  
- 第 16 节：第 5 刀为本片。MCP、桌面插件/模型页、A2UI table/chart、guard `ask` 仍后续。
