# FlintLoom 工作台工坊视觉 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pnpm desktop` 工作台改成暖色工坊外观：衬线标题、琥珀强调、空聊天文案、文件选中态；行为与现有测试保持不变。

**Architecture:** 只改 `apps/desktop`。结构钩子在 `App.tsx` / `FilePane.tsx`（空状态、`status-pill`、`btn-primary`/`btn-ghost`、文件 `selected`）。全部颜色进 `app.css` 的 `:root` 变量。不改 host、SSE、A2UI 逻辑、KnowledgePane TSX。

**Tech Stack:** 现有 React 18、Vite 6、Vitest + jsdom。不加字体包、动画库、新 npm 依赖。

## Global Constraints

- 口号与产品名：FlintLoom，A real agent. / 真正的 Agent。
- 颜色只出现在 `:root`；其它规则只用 `var(--…)`（`color-scheme` 除外）。
- 按钮可见文案不变：`发送`、`取消`、`Files`、`Knowledge`、`Import`。
- 保留选择器：`textarea`、`pre.file-preview`、`.file-preview-svg`、`input.knowledge-search`。
- 空状态必须是 `<p class="log-empty">向工作区说一句话</p>`，不是 `button`。
- 首屏自动预览第一份文件时不写 `selectedFile`。
- 不改 `apps/host/**`、`packages/**`、yml、其它 apps。
- 不引入字体文件、CDN、npm 字体包。`transition` ≤ 150ms。
- 测试夹具不依赖真实 API key。
- Windows：PowerShell 不要用 `&&`；commit 用 `git commit -m "..."` 单行。

Spec：`docs/superpowers/specs/2026-08-22-flintloom-workbench-workshop-ui-design.md`

## File map

```text
apps/desktop/tests/App.test.tsx   # 新增 4 组断言
apps/desktop/src/App.tsx          # 空状态、status-pill、btn-primary/ghost
apps/desktop/src/FilePane.tsx     # 文件 button.selected
apps/desktop/src/app.css          # token + 工坊外观（整文件替换色值）
```

---

### Task 1: 空状态、状态胶囊、按钮 class、文件选中

**Files:**
- Modify: `apps/desktop/tests/App.test.tsx`（在 `describe("App")` 末尾、最后一个 `it` 之后追加用例）
- Modify: `apps/desktop/src/App.tsx`（顶栏 span、`.log` 空状态、composer 按钮 class）
- Modify: `apps/desktop/src/FilePane.tsx`（文件按钮 `className`）

**Interfaces:**
- Consumes: 现有 `installFetch` / `mountApp` / `waitForText` / `typeAndSend` / `SURFACE_SSE`
- Produces: `.log-empty`；`.status-pill.ok|warn|down`；发送 `.btn-primary`；取消 `.btn-ghost`；文件按钮 `.selected`

- [ ] **Step 1: Write the failing tests**

每个 `it` 只调用一次 `mountApp()`（`afterEach` 才会 unmount）。在 `describe("App")` 最后一个 `it` 之后插入这 7 个用例：

```ts
  it("shows empty log copy as a paragraph", async () => {
    installFetch();
    await mountApp();
    await waitForText("向工作区说一句话");
    const empty = document.querySelector(".log-empty");
    expect(empty).toBeTruthy();
    expect(empty?.tagName).toBe("P");
  });

  it("hides empty log copy after session hydrate", async () => {
    installFetch({
      session: new Response(
        JSON.stringify({
          events: [
            { type: "user/message", text: "past user" },
            { type: "assistant/message", text: "past assistant" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    });
    await mountApp();
    await waitForText("past user");
    expect(document.body.textContent).not.toContain("向工作区说一句话");
    expect(document.querySelector(".log-empty")).toBeNull();
  });

  it("renders warn pill when chat is not configured", async () => {
    installFetch();
    await mountApp();
    await waitForText("chat 未配置");
    expect(document.querySelector(".status-pill.warn")?.textContent).toBe(
      "chat 未配置",
    );
  });

  it("renders ok pill when chat is configured", async () => {
    installFetch({
      models: new Response(JSON.stringify([{ kind: "chat", configured: true }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    });
    await mountApp();
    await waitForText("chat 已配置");
    expect(document.querySelector(".status-pill.ok")?.textContent).toBe(
      "chat 已配置",
    );
  });

  it("renders down pill when models fetch fails", async () => {
    installFetch({ models: new Error("network") });
    await mountApp();
    await waitForText("host 未连接");
    expect(document.querySelector(".status-pill.down")?.textContent).toBe(
      "host 未连接",
    );
  });

  it("marks clicked file selected and never selects directories", async () => {
    installFetch({
      files: new Response(
        JSON.stringify({
          path: ".",
          entries: [
            { name: "docs", type: "dir" },
            { name: "README.md", type: "file" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    });
    await mountApp();
    await waitForText("README.md");
    await waitForText("docs");
    const readme = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "README.md",
    );
    const docs = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "docs",
    );
    if (!readme || !docs) throw new Error("missing tree buttons");
    expect(readme.classList.contains("selected")).toBe(false);
    await act(async () => {
      docs.click();
    });
    expect(docs.classList.contains("selected")).toBe(false);
    await act(async () => {
      readme.click();
    });
    expect(readme.classList.contains("selected")).toBe(true);
    expect(docs.classList.contains("selected")).toBe(false);
  });

  it("tags send as primary and cancel as ghost", async () => {
    installFetch({
      turn: new Response(SURFACE_SSE, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    });
    await mountApp();
    const send = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "发送",
    );
    expect(send?.classList.contains("btn-primary")).toBe(true);
    await typeAndSend("hi");
    await waitForText("OK");
    const cancel = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "取消",
    );
    expect(cancel?.classList.contains("btn-ghost")).toBe(true);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run apps/desktop/tests/App.test.tsx`

Expected: FAIL。失败信息含 `向工作区说一句话` 超时，或 `.log-empty` / `.status-pill` / `btn-primary` / `selected` 为 null/false。现有用例应仍 PASS。

- [ ] **Step 3: Minimal TSX**

`App.tsx` 顶栏：

```tsx
      <header className="topbar">
        <h1>FlintLoom</h1>
        {hostDown ? (
          <span className="status-pill down">host 未连接</span>
        ) : chatConfigured === false ? (
          <span className="status-pill warn">chat 未配置</span>
        ) : chatConfigured ? (
          <span className="status-pill ok">chat 已配置</span>
        ) : null}
      </header>
```

`.log` 内，在 `bubbles.map` **之前**：

```tsx
          <main className="log">
            {bubbles.length === 0 && !draft ? (
              <p className="log-empty">向工作区说一句话</p>
            ) : null}
            {bubbles.map((bubble) => (
```

Composer 按钮：

```tsx
            <button
              type="button"
              className="btn-primary"
              disabled={sending || waitingAction || !input.trim()}
              onClick={() => void send()}
            >
              发送
            </button>
            {waitingAction || sending ? (
              <button type="button" className="btn-ghost" onClick={() => void onCancel()}>
                取消
              </button>
            ) : null}
```

`FilePane.tsx` 文件按钮（目录按钮不加 class）：

```tsx
        <div key={path} className="file-node" style={{ paddingLeft: depth * 12 }}>
          <button
            type="button"
            className={selectedFile === path ? "selected" : undefined}
            onClick={() => void openFile(path)}
          >
            {entry.name}
          </button>
        </div>
```

不要在首屏 `startPreview` 里 `setSelectedFile`。

- [ ] **Step 4: Run App tests**

Run: `pnpm exec vitest run apps/desktop/tests/App.test.tsx`

Expected: 全部 PASS（此时外观仍是旧蓝/黑，但 class 与文案已齐）。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/tests/App.test.tsx apps/desktop/src/App.tsx apps/desktop/src/FilePane.tsx
git commit -m "feat: add workbench empty state and selection classes"
```

---

### Task 2: 工坊 CSS tokens 与外观

**Files:**
- Modify: `apps/desktop/src/app.css`（整文件按下面替换）

**Interfaces:**
- Consumes: Task 1 的 class 名 `.log-empty`、`.status-pill`、`.btn-primary`、`.btn-ghost`、`.file-node button.selected`
- Produces: spec §5 token 表 + §6 外观；`.composer button` 统一主色规则删除

- [ ] **Step 1: Replace `app.css`**

把 `apps/desktop/src/app.css` 写成：

```css
:root {
  color-scheme: dark;
  --bg: #161310;
  --bg-raised: #221c18;
  --bg-panel: #2a231e;
  --bg-paper: #1c1814;
  --bg-user: #3d2e1f;
  --text: #efe6d8;
  --text-muted: #a89880;
  --line: #3d342c;
  --accent: #d4a06a;
  --accent-strong: #c4843a;
  --danger: #8f3e32;
  --btn-ink: #161310;
  --pill-down: #e0a090;
}

html,
body,
#root {
  margin: 0;
  height: 100%;
  background: var(--bg);
  color: var(--text);
  font-family: system-ui, "Segoe UI", sans-serif;
}

.workbench {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.topbar {
  display: flex;
  align-items: center;
  gap: 1rem;
  min-height: 48px;
  box-sizing: border-box;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--line);
  background: var(--bg-raised);
}

.topbar h1 {
  margin: 0;
  font-family: Georgia, "Palatino Linotype", Palatino, "Times New Roman", serif;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text);
}

.status-pill {
  font-size: 0.75rem;
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: transparent;
}

.status-pill.ok {
  border-color: var(--accent);
  color: var(--accent);
}

.status-pill.warn {
  border-color: var(--text-muted);
  color: var(--text-muted);
}

.status-pill.down {
  border-color: var(--pill-down);
  color: var(--pill-down);
}

.workbench-body {
  flex: 1;
  display: flex;
  min-height: 0;
}

.chat-column {
  flex: 1.4;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.file-pane {
  flex: 1;
  min-width: 16rem;
  border-left: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bg-raised);
}

.side-tabs {
  display: flex;
  gap: 0.25rem;
  padding: 0.35rem 0.5rem 0;
  border-bottom: 1px solid var(--line);
}

.side-tabs button {
  background: transparent;
  color: inherit;
  border: none;
  border-bottom: 2px solid transparent;
  padding: 0.4rem 0.6rem;
  cursor: pointer;
  font: inherit;
}

.side-tabs button.active {
  border-bottom-color: var(--accent);
  color: var(--accent);
}

.file-tree {
  flex: 0.7;
  overflow: auto;
  padding: 0.5rem;
}

.knowledge-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.knowledge-search {
  margin: 0.5rem;
  background: var(--bg);
  color: inherit;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 0.4rem 0.5rem;
  font: inherit;
}

.knowledge-search:focus {
  outline: none;
  border-color: var(--accent);
}

.knowledge-list {
  flex: 0.7;
  overflow: auto;
  padding: 0 0.5rem 0.5rem;
}

.knowledge-item button,
.file-node button {
  background: transparent;
  color: inherit;
  border: none;
  padding: 0.35rem 0.5rem;
  cursor: pointer;
  text-align: left;
  font: inherit;
  width: 100%;
  border-radius: 8px;
  transition: background 150ms ease, color 150ms ease;
}

.knowledge-item button:hover,
.file-node button:hover {
  background: var(--bg-panel);
}

.file-node button.selected {
  background: var(--bg-panel);
  color: var(--accent);
}

.knowledge-detail,
.file-preview {
  flex: 1;
  overflow: auto;
  margin: 0;
  padding: 0.9rem 1rem;
  border-top: 1px solid var(--line);
  background: var(--bg-paper);
  white-space: pre-wrap;
  word-break: break-word;
  font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
  font-size: 0.85rem;
  line-height: 1.45;
}

.knowledge-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-top: 1px solid var(--line);
}

.file-preview-svg img {
  max-width: 100%;
  height: auto;
  display: block;
}

.log {
  flex: 1;
  overflow: auto;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.log-empty {
  flex: 1;
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
}

.bubble {
  max-width: 42rem;
  padding: 0.6rem 0.8rem;
  border-radius: 10px;
  white-space: pre-wrap;
  word-break: break-word;
}

.bubble.user {
  align-self: flex-end;
  background: var(--bg-user);
}

.bubble.assistant,
.bubble.draft {
  align-self: flex-start;
  background: var(--bg-panel);
  border-left: 2px solid var(--accent);
}

.bubble.tool-call,
.bubble.tool-result {
  align-self: flex-start;
  background: var(--bg-paper);
  color: var(--text-muted);
  font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
  font-size: 0.85rem;
}

.bubble.error {
  align-self: flex-start;
  background: var(--danger);
}

.bubble.a2ui {
  align-self: flex-start;
  background: var(--bg-panel);
  border: 1px solid var(--line);
  padding: 0.75rem 0.9rem;
}

.a2ui-column {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.a2ui-row {
  display: flex;
  flex-direction: row;
  gap: 0.5rem;
  align-items: center;
}

.composer {
  display: flex;
  gap: 0.6rem;
  padding: 0.75rem 1rem;
  border-top: 1px solid var(--line);
  background: var(--bg-raised);
}

.composer textarea {
  flex: 1;
  resize: none;
  background: var(--bg);
  color: inherit;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 0.5rem 0.6rem;
  font: inherit;
}

.composer textarea:focus {
  outline: none;
  border-color: var(--accent);
}

.btn-primary,
.knowledge-footer button,
.bubble.a2ui button {
  background: var(--accent-strong);
  color: var(--btn-ink);
  border: none;
  border-radius: 8px;
  padding: 0 1rem;
  cursor: pointer;
  font: inherit;
}

.knowledge-footer button {
  padding: 0.35rem 0.8rem;
}

.btn-ghost {
  background: transparent;
  border: 1px solid var(--line);
  color: var(--text);
  border-radius: 8px;
  padding: 0 1rem;
  cursor: pointer;
  font: inherit;
}

.bubble.a2ui select {
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 0.25rem 0.4rem;
  font: inherit;
}

.btn-primary:disabled,
.knowledge-footer button:disabled,
.bubble.a2ui button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.bubble.a2ui select:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
```

禁止留下 `.composer button { background: #3a6ea5 … }`。组件规则里禁止再写 `#rrggbb`。

- [ ] **Step 2: Grep leftover magic colors**

Run: `pnpm exec vitest run apps/desktop/tests/App.test.tsx` 之前先在 `app.css` 搜 `#`。允许出现的只有 `:root` 里 token 赋值，以及没有其它 `#`。

- [ ] **Step 3: Run desktop tests**

Run: `pnpm exec vitest run apps/desktop/tests`

Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/app.css
git commit -m "feat: restyle workbench with workshop tokens"
```

---

### Task 3: 全量回归

**Files:**
- Test: `apps/desktop/tests/**`、仓库 `pnpm test`、`pnpm typecheck`

**Interfaces:**
- Consumes: Task 1–2 产物
- Produces: 绿测试 + typecheck 0

- [ ] **Step 1: Desktop + repo tests + typecheck**

Run: `pnpm exec vitest run apps/desktop/tests`

Expected: PASS。

Run: `pnpm test`

Expected: 全部 PASS。

Run: `pnpm typecheck`

Expected: exit 0。

- [ ] **Step 2: Manual check（若 `pnpm desktop` 已在跑，刷新 `http://127.0.0.1:5173`）**

确认：衬线标题、琥珀胶囊、空状态句、点文件行变琥珀、发送铜色 / 取消描边。不改行为。

- [ ] **Step 3: Commit only if Task 3 produced extra diffs**

若无 diff 则跳过。有则：

```bash
git add -u
git commit -m "fix: keep workbench workshop ui typecheck clean"
```

---

## Spec coverage

| Spec | Task |
|---|---|
| 空状态 `<p class="log-empty">` 及 hydrate 消失 | 1 |
| `status-pill` ok/warn/down 文案不变 | 1 |
| 文件 `selected`；目录永不 selected；首屏不 selected | 1 |
| `btn-primary` / `btn-ghost` | 1 |
| Token 表、禁止组件魔法色、系统字体、圆角 | 2 |
| 顶栏 / 气泡 / composer / 侧栏 / A2UI 控件色 | 2 |
| Knowledge 只吃 CSS | 2（`.knowledge-footer button`） |
| 不重排三栏、不改 host | 全任务未列入那些文件 |
| `apps/desktop/tests` + `typecheck` | 3 |
