# FlintLoom 可选能力开关 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 插件页可开关本产品可选能力（天气、知识库、文档等）；关知识库则文档一并关且 host 不崩；系统提示只描述当前已注册工具。聊天框「联网」保持唯一本轮开关。

**Architecture:** 复用第一期的 `enabled` / `pluginKind` / `replaceYmlAtomic` / 原子 `reloadRuntime`。新增 `GET /v1/plugins/declared` 与 `PATCH /v1/plugins/:id`。`docforge` 在没有 `knowledge` 时跳过登记。loop 按 schema 裁剪 system。桌面能力块 + 知识库 404 空态。

**Tech Stack:** 现有 kernel / host / desktop / loop / docforge、Vitest。本计划 **依赖** 第一期计划已合并：`docs/superpowers/plans/2026-09-04-flintloom-mcp-server-manager.md`。

## Global Constraints

- Spec：`docs/superpowers/specs/2026-09-04-flintloom-plugin-capability-manager-design.md`
- 不可关：内核 id、渠道、`web-search`。`PATCH` 这些 id → 400。
- 关 `knowledge` 时同一写入把 `docforge` 设为 `enabled: false`。知识库关着时 PATCH 开 `docforge` → 400 `knowledge`。
- Composer「联网」与 `runTurn` 过滤 `web_search` 不改。
- `GET /v1/plugins` 语义不改（仍只有已 apply 的 `loaded`）。
- `apps/host/src` 仍不得出现 `@flintloom/mcp` / `mcp__`。
- Windows：指定 `git add`；PowerShell heredoc commit；不要 `&&`；不要 `Co-authored-by`。
- 不做按工具勾选、渠道开关、`fs`/`shell` 开关、MCP HTTP。

## File map

```text
packages/kernel/src/plugins-write.ts       # 写 flintloom.yml 某行 enabled
packages/kernel/src/index.ts
packages/kernel/tests/plugins-write.test.ts

apps/host/src/plugins-declared-http.ts     # GET declared + PATCH
apps/host/src/server.ts                    # 挂路由
apps/host/tests/server.test.ts

packages/docforge/src/index.ts             # ctx.get("knowledge")，缺则不登记
packages/docforge/tests/plugin.test.ts

packages/loop/src/run-turn.ts              # conversationSystemMessage(toolNames)
packages/loop/tests/generationDir.test.ts

apps/desktop/src/api.ts
apps/desktop/src/PluginsPane.tsx
apps/desktop/src/knowledge.ts              # 404 → 专用错误
apps/desktop/src/KnowledgePane.tsx
apps/desktop/tests/App.test.tsx
```

---

### Task 1: 写回 `flintloom.yml` 的 `enabled`

**Files:**
- Create: `packages/kernel/src/plugins-write.ts`
- Modify: `packages/kernel/src/index.ts`
- Test: `packages/kernel/tests/plugins-write.test.ts`

**Interfaces:**
- Consumes: `replaceYmlAtomic`、`loadConfig`、`isPluginToggleable`、`pluginKind`、`parseDocument`
- Produces:

```ts
export function setPluginEnabled(
  workspaceRoot: string,
  id: string,
  enabled: boolean,
): void;
```

行为：

- 找不到该 id → throw `"id"`
- `!isPluginToggleable(row)` → throw `"toggleable"`（含 `web-search` / `loop` / 渠道）
- `id === "knowledge" && enabled === false`：同时给 `docforge` 行删不删都行，但必须把 `docforge` 写成 `enabled: false`（若 yml 有该行）
- `id === "docforge" && enabled === true`：若 knowledge 行缺失或 `enabled === false` → throw `"knowledge"`
- `enabled === true`：从该行删除 `enabled` 键
- dump 后 `loadConfig` 再校验再原子写

- [ ] **Step 1: Write failing tests**（临时目录写一份含 weather/knowledge/docforge/loop 的 yml）

  - 关 weather → 文件含 `enabled: false`，再开会无 `enabled:`
  - 关 loop → throw `toggleable`，文件不变
  - 关 knowledge → docforge 亦 false
  - knowledge 已 false 时开 docforge → throw `knowledge`

- [ ] **Step 2:** `pnpm --filter @flintloom/kernel exec vitest run tests/plugins-write.test.ts` — FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: PASS**
- [ ] **Step 5: Commit**

```powershell
git add packages/kernel/src/plugins-write.ts packages/kernel/src/index.ts packages/kernel/tests/plugins-write.test.ts
git commit -m @"
feat(kernel): 按行开关 flintloom.yml 可选插件

可关能力写入 enabled: false；关知识库时同时关掉文档；内核与联网搜索拒绝开关。
"@
```

---

### Task 2: `GET /v1/plugins/declared` 与 `PATCH /v1/plugins/:id`

**Files:**
- Create: `apps/host/src/plugins-declared-http.ts`
- Modify: `apps/host/src/server.ts`
- Test: `apps/host/tests/server.test.ts`

**Interfaces:**
- Consumes: `loadConfig`、`pluginKind`、`isPluginToggleable`、`setPluginEnabled`、`reloadRuntime`
- Produces:

GET `{ plugins: [{ id, name, kind, enabled, toggleable }] }`，`enabled` 缺省 true。不含 `config`。

PATCH `body: { enabled: boolean }`：调用 `setPluginEnabled`；busy → 409 JSON `{ error: "busy", written: true }`（与 MCP 新接口相同）；否则 `reloadRuntime`。

400 文本：`id` / `toggleable` / `knowledge`（与 throw message 一致）。`web-search` 与 `loop` 必须 400。

- [ ] **Step 1: HTTP tests**

  - GET declared 含 `weather` `toggleable: true`，`loop` `toggleable: false`，`web-search` `kind: "search"`
  - PATCH weather false → 再 GET declared `enabled: false`；`createRuntime` schema 无 `get_weather`（可再调 `createRuntime` 或 GET `/v1/plugins` 无 weather 行）
  - PATCH `web-search` / `loop` → 400
  - PATCH docforge true 而 knowledge 已 false → 400 `knowledge`
  - 无 token GET → 401

- [ ] **Step 2: FAIL 404**
- [ ] **Step 3: Implement + wire 在 `GET /v1/plugins` 附近**
- [ ] **Step 4: PASS；现有 GET `/v1/plugins` 仍只有 `status: "loaded"`**
- [ ] **Step 5: Commit**

```powershell
git add apps/host/src/plugins-declared-http.ts apps/host/src/server.ts apps/host/tests/server.test.ts
git commit -m @"
feat(host): 声明清单与可选插件开关接口

桌面可读取含禁用项的插件声明，并 PATCH enabled 写回工作区 YAML 后原子重载。
"@
```

---

### Task 3: `docforge` 在缺少 knowledge 时不崩

**Files:**
- Modify: `packages/docforge/src/index.ts`
- Test: `packages/docforge/tests/plugin.test.ts`
- Test: `apps/host/tests/server.test.ts`（yml 关 knowledge 仍 `createRuntime` 成功且无 `doc_*`）

**Interfaces:**
- Consumes: `ctx.get<KnowledgeService>("knowledge")` 替代 `require`
- Produces: knowledge 缺失时 `apply` 直接 return，不 register `doc_*`

现有「registers doc_probe…」用例保持（仍先挂 knowledge）。追加：

```ts
  it("skips tools when knowledge is missing", async () => {
    const ctx = new Context();
    ctx.plugin(modelsPlugin);
    ctx.plugin(toolsPlugin);
    await ctx.plugin(plugin);
    const names = ctx.require<ToolRegistry>("tools").schemas().map((s) => s.name);
    expect(names.some((n) => n.startsWith("doc_"))).toBe(false);
  });
```

host 集成：`flintloom.yml` 里 knowledge `enabled: false`、docforge 仍为 true（模拟手改）→ `createRuntime` 成功，schema 无 `doc_probe`，`GET /v1/knowledge` 404。

- [ ] **Step 1: Write failing plugin test**
- [ ] **Step 2:** `pnpm --filter @flintloom/docforge exec vitest run tests/plugin.test.ts` — FAIL（require 抛 `knowledge`）
- [ ] **Step 3:** `const kb = ctx.get<KnowledgeService>("knowledge"); if (kb === undefined) return;` 再用 kb 登记 ingest
- [ ] **Step 4: PASS + host 手改 yml 用例**
- [ ] **Step 5: Commit**

```powershell
git add packages/docforge/src/index.ts packages/docforge/tests/plugin.test.ts apps/host/tests/server.test.ts
git commit -m @"
fix(docforge): 没有知识库时跳过文档工具

避免只关知识库或手改 yml 时 host 因 require knowledge 无法启动。
"@
```

---

### Task 4: loop 系统提示按已注册工具裁剪

**Files:**
- Modify: `packages/loop/src/run-turn.ts`
- Test: `packages/loop/tests/generationDir.test.ts`

**Interfaces:**
- Consumes: `tools.schemas().map(s => s.name)`
- Produces: `conversationSystemMessage(webSearch, generationDir, toolNames: string[])`

逻辑（精确）：

- 基句「You are FlintLoom… workspace.」+ generationDir 句 **始终**有。
- 仅当 `toolNames` 含任意 `doc_` 前缀时，保留「Then call doc_generate…」那句。
- 仅当含 `a2ui_emit` 时，保留 A2UI 句。
- 仅当含 `infographic_render` 时，保留信息图句；若无 `a2ui_emit` 但有 `infographic_render`，信息图句仍要（不要依赖 A2UI 句里的 “do not switch”）。
- 联网句仍只由 `webSearch === true` 追加。

在 `runTurn` 里 `chatProvider.stream` 之前取当前 schema 名字传入。现有 `generationDir.test.ts` 里 fake 工具只有 `touch`，**今天** system 仍含 `a2ui_emit`。改完后该断言要改成 `not.toContain("a2ui_emit")`，并保留 mkdir/dates/generationDir 断言。这是预期变化，同一任务改测试。

另写一个用例：先 `register` 名为 `a2ui_emit` 的空工具，断言 system 含 `a2ui_emit`。

- [ ] **Step 1: 改 generationDir 测试为「默认无 a2ui」并追加「有 a2ui 工具则提示包含」**
- [ ] **Step 2: Run loop tests — FAIL（旧断言还期望无工具时含 a2ui_emit）**
- [ ] **Step 3: 改 `conversationSystemMessage` 与调用点**
- [ ] **Step 4:** `pnpm --filter @flintloom/loop test` PASS
- [ ] **Step 5: Commit**

```powershell
git add packages/loop/src/run-turn.ts packages/loop/tests/generationDir.test.ts
git commit -m @"
fix(loop): 系统提示只描述当前已注册工具

关掉界面或文档插件后，不再要求模型调用 a2ui_emit、infographic_render 或 doc_generate。
"@
```

---

### Task 5: 桌面能力块与知识库空态

**Files:**
- Modify: `apps/desktop/src/api.ts`（`fetchDeclaredPlugins`、`setPluginEnabled`）
- Modify: `apps/desktop/src/PluginsPane.tsx`
- Modify: `apps/desktop/src/knowledge.ts`
- Modify: `apps/desktop/src/KnowledgePane.tsx`
- Modify: `apps/desktop/tests/App.test.tsx`

**Interfaces:**

```ts
export type DeclaredPlugin = {
  id: string;
  name: string;
  kind: "core" | "optional" | "channel" | "search" | "mcp";
  enabled: boolean;
  toggleable: boolean;
};

export function fetchDeclaredPlugins(signal?: AbortSignal): Promise<{ plugins: DeclaredPlugin[] }>;
export function setDeclaredPluginEnabled(id: string, enabled: boolean): Promise<void>;
```

UI：

- **可选能力**：`kind === "optional"` 的开关列表。`knowledge` 与 `docforge` 成组：knowledge 关则 docforge 开关 disabled，旁注「需要先打开知识库」。无 `web-search` 行；一句「联网在对话输入栏」。
- **内核与渠道**：改用 `declared` 的 `kind === "core" | "channel" | "search"`，只读折叠。不再用 `GET /v1/plugins` 充当内核表（MCP 仍只在第一块）。
- `kind === "mcp"` 的 yml 手写行：只读一行提示迁到 `mcp-servers.yml`，不在能力开关里。

知识库：

- `fetchKnowledge`：404 → throw `Error("knowledge-disabled")`（不要 `host unreachable`）
- `KnowledgePane`：该错误显示「已在插件页关闭」，`error` 为其它原因仍可 `host unreachable`

测试：

- mock declared 含 weather enabled；插件页可点开关（断言 fetch PATCH）
- 无 `web-search` 能力开关文案当标题；页面仍可提「对话输入栏」
- knowledge 404 → 侧栏文案含「插件页」，不含 `host unreachable`
- Composer 测试里「联网」按钮仍在（现有 WebSearchToggle 用例不要删）

`installFetch` 增加 `declaredPlugins` / `declaredPatch`，默认给一份最小 declared，以免插件页第二期代码一挂载就挂。

- [ ] **Step 1: 更新/新增 desktop 测试**
- [ ] **Step 2: FAIL**
- [ ] **Step 3: UI + knowledge 404 分支**
- [ ] **Step 4:** `pnpm --filter @flintloom/desktop test` PASS
- [ ] **Step 5: Commit**

```powershell
git add apps/desktop/src/api.ts apps/desktop/src/PluginsPane.tsx apps/desktop/src/knowledge.ts apps/desktop/src/KnowledgePane.tsx apps/desktop/tests/App.test.tsx
git commit -m @"
feat(desktop): 插件页开关可选能力并修正知识库空态

天气与知识库等可在管理页关闭；关知识库后侧栏说明去插件页开启，不再误报 host 不可达。
"@
```

---

### Task 6: 回归

- [ ] **Step 1:** `pnpm test`
- [ ] **Step 2:** `pnpm typecheck`
- [ ] **Step 3:** 手工：关天气 → 无 `get_weather`；关知识库 → 侧栏空态、文档工具消失、预览 md 仍可用；聊天框仍有「联网」。
