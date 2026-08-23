# FlintLoom 桌面凭据与 Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 工作台 Settings 页按 slot 读写 `~/.flintloom/credentials`，host 合并 overlay 并支持 `POST /v1/settings/reload` 热重载 runtime；Models 页仍只读。

**Architecture:** 新建 `credentials.ts` 管 JSON schema / mask / 分层合并；`createRuntime` 在 env > `.env` > credentials 顺序解析 chat/media/guard/telegram；`startHost` 用 `runtimeRef` 供 reload 替换；桌面 `SettingsPane` 调 GET/PUT/reload。

**Tech Stack:** Node `fs`、现有 host HTTP、`apps/desktop` React + Vite 代理 Bearer。不新增 npm 包、不改 `runTurn`、不 import 新 Loom 包。

## Global Constraints

- 优先级：**进程 env > 工作区 `.env` > `~/.flintloom/credentials`**；Settings **只写 credentials**，不修改 `.env`。
- `GET` 永不返回完整 apiKey/token；`maskedKey` 规则：长度 ≤8 → `***`，否则首尾 4 + `…`。
- `Error.message` / 500 正文不含密钥、`hostToken`、绝对 `homeDir`（延续 `formatHostError` redact）。
- 本地 chat URL 不因 chat 自动 overlay media/guard；独立 media/guard slot 仍 overlay（slice 33–34）。
- reload 时 `busy.size > 0` → **409**，消息含 `busy`。
- reload 保持 `pollChannels: true`（与 `startHost` 一致）。
- host 禁止 import 新 Loom 包；不改 `flintloom.yml` 从 UI。
- Windows：PowerShell 不用 `&&`；`git commit -m "..." -m "..."`。
- Spec：`docs/superpowers/specs/2026-08-23-flintloom-desktop-credentials-channels-design.md`

## File map

```text
apps/host/src/credentials.ts          # 新建
apps/host/src/settings.ts             # 新建：GET/PUT/reload handlers
apps/host/src/token.ts                # 保留 loadOrCreateToken；readCredentials 迁出或 re-export
apps/host/src/server.ts               # overlay 合并、runtimeRef、路由挂载
apps/host/src/index.ts                # 可选 export credentials helpers
apps/host/tests/credentials.test.ts   # 新建
apps/host/tests/server.test.ts        # settings HTTP + reload

apps/desktop/src/api.ts
apps/desktop/src/SettingsPane.tsx     # 新建
apps/desktop/src/App.tsx
apps/desktop/src/ModelsPane.tsx
apps/desktop/src/app.css
apps/desktop/tests/App.test.tsx

docs/setup-and-launch.md
```

---

### Task 1: `credentials.ts` 读写与 mask

**Files:**
- Create: `apps/host/src/credentials.ts`
- Create: `apps/host/tests/credentials.test.ts`
- Modify: `apps/host/src/token.ts`（`readCredentials` 改为从 `credentials.ts` re-export，或删除重复实现）

**Interfaces:**
- Consumes: 无
- Produces:
  - `export type CredentialSlotId = "chat" | "media" | "guard" | "telegram"`
  - `export type CredentialSource = "env" | "credentials" | "none"`
  - `export type CredentialsStore = { hostToken?: string; chatApiKey?: string; providers?: Record<string, Record<string, string>>; channels?: Record<string, Record<string, string>> }`
  - `export function credentialsPath(homeDir: string): string`
  - `export function readCredentialsStore(homeDir: string): CredentialsStore`
  - `export function writeCredentialsStore(homeDir: string, store: CredentialsStore): void`
  - `export function maskSecret(value: string): string`
  - `export function normalizeCredentialsStore(raw: CredentialsStore): CredentialsStore`（顶层 `chatApiKey` → `providers.chat.apiKey`）

- [ ] **Step 1: 写失败测试 `maskSecret`**

```typescript
import { describe, expect, it } from "vitest";
import { maskSecret } from "../src/credentials.ts";

describe("maskSecret", () => {
  it("masks short secrets as stars", () => {
    expect(maskSecret("local")).toBe("***");
  });

  it("masks long secrets with head and tail", () => {
    expect(maskSecret("sk-abcdefghijklmnop")).toBe("sk-a…mnop");
  });
});
```

- [ ] **Step 2: 跑测试确认 FAIL**

Run: `pnpm exec vitest run apps/host/tests/credentials.test.ts`

Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `credentials.ts` 最小集**

```typescript
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type CredentialSlotId = "chat" | "media" | "guard" | "telegram";
export type CredentialSource = "env" | "credentials" | "none";

export type CredentialsStore = {
  hostToken?: string;
  chatApiKey?: string;
  providers?: Record<string, Record<string, string>>;
  channels?: Record<string, Record<string, string>>;
};

export function credentialsPath(homeDir: string): string {
  return join(homeDir, ".flintloom", "credentials");
}

export function readCredentialsStore(homeDir: string): CredentialsStore {
  try {
    const parsed: unknown = JSON.parse(readFileSync(credentialsPath(homeDir), "utf8"));
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return normalizeCredentialsStore(parsed as CredentialsStore);
    }
  } catch {
    // missing or invalid
  }
  return {};
}

export function writeCredentialsStore(homeDir: string, store: CredentialsStore): void {
  mkdirSync(join(homeDir, ".flintloom"), { recursive: true });
  writeFileSync(credentialsPath(homeDir), JSON.stringify(store), "utf8");
}

export function normalizeCredentialsStore(raw: CredentialsStore): CredentialsStore {
  const store: CredentialsStore = { ...raw };
  if (
    typeof store.chatApiKey === "string" &&
    store.chatApiKey.length > 0 &&
    store.providers?.chat?.apiKey === undefined
  ) {
    store.providers = {
      ...store.providers,
      chat: { ...store.providers?.chat, apiKey: store.chatApiKey },
    };
  }
  return store;
}

export function maskSecret(value: string): string {
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
```

- [ ] **Step 4: 补读写 round-trip 测试**

```typescript
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  readCredentialsStore,
  writeCredentialsStore,
} from "../src/credentials.ts";

it("writes and reads providers.media", () => {
  const home = mkdtempSync(join(tmpdir(), "flintloom-cred-"));
  writeCredentialsStore(home, {
    providers: { media: { apiKey: "sk-test", baseUrl: "https://example.com/v1" } },
  });
  const store = readCredentialsStore(home);
  expect(store.providers?.media?.apiKey).toBe("sk-test");
});
```

- [ ] **Step 5: 跑 credentials 测试 PASS**

Run: `pnpm exec vitest run apps/host/tests/credentials.test.ts`

- [ ] **Step 6: 更新 `token.ts` re-export**

```typescript
import { readCredentialsStore, writeCredentialsStore, credentialsPath } from "./credentials.ts";

export function readCredentials(homeDir: string): Record<string, unknown> {
  return readCredentialsStore(homeDir) as Record<string, unknown>;
}

export function loadOrCreateToken(homeDir: string): string {
  const store = readCredentialsStore(homeDir);
  if (typeof store.hostToken === "string" && store.hostToken.length > 0) {
    return store.hostToken;
  }
  const hostToken = randomBytes(24).toString("hex");
  writeCredentialsStore(homeDir, { ...store, hostToken });
  return hostToken;
}
```

- [ ] **Step 7: Commit**

```bash
git add apps/host/src/credentials.ts apps/host/src/token.ts apps/host/tests/credentials.test.ts
git commit -m "feat(host): credentials store read/write and mask"
```

---

### Task 2: `createRuntime` 分层合并

**Files:**
- Modify: `apps/host/src/server.ts`
- Modify: `apps/host/tests/server.test.ts`

**Interfaces:**
- Consumes: `readCredentialsStore`, `CredentialSource` from `credentials.ts`
- Produces:
  - `export function resolveLayeredString(envKeys: string[], fileEnv: Record<string, string>, credValue: string | undefined): { value: string | undefined; source: CredentialSource }`
  - `createRuntime` overlay 使用 layered 结果；`resolveTelegramOverlay` 合并 credentials `channels.telegram`

- [ ] **Step 1: 写失败测试「credentials media + 本地 chat .env」**

在 `server.test.ts` 增加（与 slice 34 hybrid 类似，但 media 只写在 credentials）：

```typescript
it("credentials media overlays when chat is local via .env", async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-host-cred-media-"));
  const homeDir = mkdtempSync(join(tmpdir(), "flintloom-host-home-"));
  writeAssembly(workspaceRoot);
  writeFileSync(
    join(workspaceRoot, ".env"),
    [
      "FLINTLOOM_BASE_URL=http://127.0.0.1:8080/v1",
      "FLINTLOOM_API_KEY=local",
      "FLINTLOOM_CHAT_MODEL=local-model",
    ].join("\n"),
  );
  writeFileSync(
    join(homeDir, ".flintloom", "credentials"),
    JSON.stringify({
      providers: {
        media: {
          apiKey: "sk-from-cred",
          baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        },
      },
    }),
  );

  delete process.env.FLINTLOOM_API_KEY;
  delete process.env.FLINTLOOM_BASE_URL;
  try {
    const { ctx, stop } = await createRuntime(workspaceRoot, homeDir);
    const snap = ctx.require<ModelRegistry>("models").snapshot();
    expect(snap.find((r) => r.kind === "chat")?.configured).toBe(true);
    expect(snap.find((r) => r.kind === "asr")?.configured).toBe(true);
    stop();
  } finally {
    delete process.env.FLINTLOOM_API_KEY;
    delete process.env.FLINTLOOM_BASE_URL;
  }
});
```

- [ ] **Step 2: 跑该测试 FAIL**

Run: `pnpm exec vitest run apps/host/tests/server.test.ts -t "credentials media"`

- [ ] **Step 3: 在 `server.ts` 实现 `resolveLayeredString` 并改写 overlay**

核心逻辑（替换现有 `resolveChatApiKey` / 直接 env 读取）：

```typescript
function resolveLayeredString(
  envKey: string,
  fileEnv: Record<string, string>,
  credValue: string | undefined,
): { value: string | undefined; source: CredentialSource } {
  const fromProcess = process.env[envKey];
  if (typeof fromProcess === "string" && fromProcess.length > 0) {
    return { value: fromProcess, source: "env" };
  }
  const fromFile = fileEnv[envKey];
  if (typeof fromFile === "string" && fromFile.length > 0) {
    return { value: fromFile, source: "env" };
  }
  if (typeof credValue === "string" && credValue.length > 0) {
    return { value: credValue, source: "credentials" };
  }
  return { value: undefined, source: "none" };
}
```

chat apiKey：

```typescript
const credStore = readCredentialsStore(homeDir);
const chatKeyLayer = resolveLayeredString(
  "FLINTLOOM_API_KEY",
  fileEnv,
  credStore.providers?.chat?.apiKey,
);
const apiKey = chatKeyLayer.value;
```

telegram overlay 扩展 `resolveTelegramOverlay(fileEnv, credStore)`：token / chatIds 同样 layered。

- [ ] **Step 4: 跑 server 测试 PASS**

Run: `pnpm exec vitest run apps/host/tests/server.test.ts`

- [ ] **Step 5: Commit**

```bash
git add apps/host/src/server.ts apps/host/tests/server.test.ts
git commit -m "feat(host): merge credentials into createRuntime overlay"
```

---

### Task 3: Settings HTTP + runtime reload

**Files:**
- Create: `apps/host/src/settings.ts`
- Modify: `apps/host/src/server.ts`（`runtimeRef`、`handleSettingsRequest`、路由）
- Modify: `apps/host/tests/server.test.ts`

**Interfaces:**
- Consumes: `maskSecret`, `readCredentialsStore`, `writeCredentialsStore`, `CredentialSlotId`, `resolveLayeredString`（或从 server 导出 snapshot builder）
- Produces:
  - `export type CredentialSlotSnapshot = { id: CredentialSlotId; label: string; configured: boolean; source: CredentialSource; baseUrl?: string; model?: string; allowedChatIds?: string; maskedKey?: string }`
  - `export function buildCredentialsSnapshot(homeDir: string, workspaceRoot: string): { slots: CredentialSlotSnapshot[]; webhook: { url: string; hint: string } }`
  - `export function applyCredentialPatch(homeDir: string, slotId: CredentialSlotId, body: Record<string, unknown>): void`
  - `export async function handleSettingsRequest(req, res, opts): Promise<boolean>`
  - `startHost` 内 `const runtimeRef = { current: runtime }`；`handleRequest` 读 `runtimeRef.current`

- [ ] **Step 1: 写失败测试 GET settings**

```typescript
it("GET /v1/settings/credentials returns masked slots", async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-host-set-"));
  const homeDir = mkdtempSync(join(tmpdir(), "flintloom-host-home-"));
  writeAssembly(workspaceRoot);
  writeFileSync(
    join(homeDir, ".flintloom", "credentials"),
    JSON.stringify({
      hostToken: "tok",
      providers: { media: { apiKey: "sk-abcdefghijklmnop" } },
    }),
  );
  const host = await startHost({ workspaceRoot, homeDir, port: 0 });
  const token = readFileSync(join(homeDir, ".flintloom", "credentials"), "utf8");
  const parsed = JSON.parse(token) as { hostToken: string };
  const res = await fetch(`${host.url}/v1/settings/credentials`, {
    headers: { Authorization: `Bearer ${parsed.hostToken}` },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { slots: { id: string; maskedKey?: string }[] };
  const media = body.slots.find((s) => s.id === "media");
  expect(media?.maskedKey).toBe("sk-a…mnop");
  expect(JSON.stringify(body)).not.toContain("sk-abcdefghijklmnop");
  await host.close();
});
```

- [ ] **Step 2: 实现 `buildCredentialsSnapshot` + GET 路由**

`settings.ts` 中 `handleSettingsRequest` 匹配：

- `GET /v1/settings/credentials`
- `PUT /v1/settings/credentials/:slotId`
- `POST /v1/settings/reload`

PUT body 解析：仅更新出现的字段；`apiKey: ""` 删除 credentials 中该字段。

`allowedChatIds` 非法 → 400 text `allowedChatIds`。

- [ ] **Step 3: 实现 reload + runtimeRef**

`server.ts` `startHost`：

```typescript
const runtimeRef = { current: runtime };
// handleRequest opts: { runtimeRef, homeDir, workspaceRoot, pollChannels: true, ... }
// POST /v1/settings/reload:
if (busy.size > 0) { send(res, 409, "busy"); return; }
runtimeRef.current.stop();
runtimeRef.current = await createRuntime(opts.workspaceRoot, opts.homeDir, { pollChannels: true });
send(res, 200, JSON.stringify({ ok: true }));
```

所有 `opts.runtime.ctx` 改为 `opts.runtimeRef.current.ctx`。

- [ ] **Step 4: 写测试 PUT media + reload → asr configured**

```typescript
it("PUT media and reload configures asr", async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-host-put-"));
  const homeDir = mkdtempSync(join(tmpdir(), "flintloom-host-home-"));
  writeAssembly(workspaceRoot);
  const host = await startHost({ workspaceRoot, homeDir, port: 0 });
  const store = JSON.parse(readFileSync(join(homeDir, ".flintloom", "credentials"), "utf8")) as { hostToken: string };
  const put = await fetch(`${host.url}/v1/settings/credentials/media`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${store.hostToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      apiKey: "sk-cloud",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    }),
  });
  expect(put.status).toBe(200);
  const reload = await fetch(`${host.url}/v1/settings/reload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${store.hostToken}` },
  });
  expect(reload.status).toBe(200);
  const models = await fetch(`${host.url}/v1/models`, {
    headers: { Authorization: `Bearer ${store.hostToken}` },
  });
  const snap = (await models.json()) as { kind: string; configured: boolean }[];
  expect(snap.find((r) => r.kind === "asr")?.configured).toBe(true);
  await host.close();
});
```

- [ ] **Step 5: 写测试 reload busy → 409**（向 `busy` 手动 add sessionId 或 mock in-flight）

- [ ] **Step 6: 跑 host 测试 PASS**

Run: `pnpm exec vitest run apps/host/tests/server.test.ts apps/host/tests/credentials.test.ts`

- [ ] **Step 7: Commit**

```bash
git add apps/host/src/settings.ts apps/host/src/server.ts apps/host/tests/server.test.ts
git commit -m "feat(host): settings credentials API and runtime reload"
```

---

### Task 4: Desktop Settings 页

**Files:**
- Modify: `apps/desktop/src/api.ts`
- Create: `apps/desktop/src/SettingsPane.tsx`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/app.css`
- Modify: `apps/desktop/tests/App.test.tsx`

**Interfaces:**
- Consumes: host `GET/PUT /v1/settings/credentials`、`POST /v1/settings/reload`（Vite 代理已带 Bearer）
- Produces:
  - `export type CredentialSlotSnapshot = { id: string; label: string; configured: boolean; source: string; baseUrl?: string; model?: string; allowedChatIds?: string; maskedKey?: string }`
  - `export async function fetchCredentialSettings(signal?: AbortSignal): Promise<{ slots: CredentialSlotSnapshot[]; webhook: { url: string; hint: string } }>`
  - `export async function putCredentialSlot(slotId: string, body: Record<string, string>): Promise<void>`
  - `export async function reloadHostSettings(): Promise<void>`（409 抛错含 `busy`）
  - `export function SettingsPane(props: { onSaved?: () => void })`

- [ ] **Step 1: `api.ts` 三个函数**

```typescript
export async function fetchCredentialSettings(signal?: AbortSignal) {
  const res = await fetch("/v1/settings/credentials", { signal });
  if (!res.ok) throw new Error("host unreachable");
  return (await res.json()) as {
    slots: CredentialSlotSnapshot[];
    webhook: { url: string; hint: string };
  };
}

export async function putCredentialSlot(
  slotId: string,
  body: Record<string, string>,
): Promise<void> {
  const res = await fetch(`/v1/settings/credentials/${encodeURIComponent(slotId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("save failed");
}

export async function reloadHostSettings(): Promise<void> {
  const res = await fetch("/v1/settings/reload", { method: "POST" });
  if (res.status === 409) throw new Error("busy");
  if (!res.ok) throw new Error("reload failed");
}
```

- [ ] **Step 2: `SettingsPane.tsx`**

- 四张卡片：`chat`、`media`、`guard`、`telegram` + webhook 只读块
- 每卡：`baseUrl`/`model`/`allowedChatIds` text input；`apiKey` password input（placeholder 显示 `maskedKey`）
- source pill：`env` →「来自 .env」；`credentials` →「来自本机凭据」
- guard 卡片固定本地 llama 提示文案（spec §6.4）
- 保存按钮：`putCredentialSlot` → `reloadHostSettings`；成功 `setMessage("已重载")`；`busy` →「有对话进行中，请稍后再保存」
- 「清除密钥」：`putCredentialSlot(id, { apiKey: "" })` + reload

- [ ] **Step 3: `App.tsx`**

- `page` 联合类型加 `"settings"`
- 顶栏按钮 `Settings`
- `page === "settings"` 时 `<main className="settings-pane"><SettingsPane onSaved={() => void fetchModels(...)} /></main>`；**不**显示 FilePane
- Chat 页 `fetchModels` 逻辑不变

- [ ] **Step 4: `app.css`**

- `.settings-card`、`.settings-form-row`、`.settings-source-pill`、与现有 `settings-pane` token 一致

- [ ] **Step 5: App 测试**

```typescript
it("renders Settings page with credential slots", async () => {
  global.fetch = vi.fn(async (input: RequestInfo) => {
    const url = String(input);
    if (url.includes("/v1/settings/credentials")) {
      return new Response(
        JSON.stringify({
          slots: [
            { id: "chat", label: "Chat / Omni", configured: true, source: "env", maskedKey: "loca…cal" },
            { id: "media", label: "Media", configured: false, source: "none" },
          ],
          webhook: { url: "http://127.0.0.1:7331/v1/hooks", hint: "Bearer hostToken" },
        }),
        { status: 200 },
      );
    }
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  render(<App />);
  await userEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect(screen.getByText(/Chat \/ Omni/)).toBeInTheDocument();
  expect(screen.getByText(/来自 .env/)).toBeInTheDocument();
});
```

- [ ] **Step 6: 跑 desktop 测试**

Run: `pnpm exec vitest run apps/desktop/tests/App.test.tsx -t "Settings"`

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/api.ts apps/desktop/src/SettingsPane.tsx apps/desktop/src/App.tsx apps/desktop/src/app.css apps/desktop/tests/App.test.tsx
git commit -m "feat(desktop): Settings pane for per-slot credentials"
```

---

### Task 5: Models 联动、文档与全量验证

**Files:**
- Modify: `apps/desktop/src/ModelsPane.tsx`
- Modify: `docs/setup-and-launch.md`

**Interfaces:**
- Consumes: `App` 的 `setPage("settings")` 需通过 ModelsPane 回调或 `window` 事件；推荐 `ModelsPane({ onOpenSettings }: { onOpenSettings?: () => void })`

- [ ] **Step 1: ModelsPane 底部链接**

```tsx
<p className="settings-hint">
  在 <button type="button" className="linkish" onClick={onOpenSettings}>Settings</button> 配置密钥（本页只读）。
</p>
```

`App.tsx` 传 `onOpenSettings={() => setPage("settings")}`。

- [ ] **Step 2: 更新 `setup-and-launch.md`**

增加小节：Settings 页、`~/.flintloom/credentials` schema、优先级 env > `.env` > credentials、`POST /v1/settings/reload`。

- [ ] **Step 3: 全量验证**

Run: `pnpm exec vitest run apps/host/tests/credentials.test.ts apps/host/tests/server.test.ts`

Run: `pnpm exec vitest run apps/desktop/tests/App.test.tsx`

Run: `pnpm typecheck`

Expected: 全 PASS / exit 0

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/ModelsPane.tsx apps/desktop/src/App.tsx docs/setup-and-launch.md
git commit -m "docs: Settings credentials and Models pane link"
```

---

## Spec coverage

| Spec § | Task |
|--------|------|
| credentials v2 schema | 1 |
| env > `.env` > credentials | 2 |
| chat/media/guard/telegram overlay | 2 |
| 本地 chat + credentials media | 2 |
| GET masked snapshots | 3 |
| PUT partial update / clear apiKey | 3 |
| POST reload + pollChannels | 3 |
| reload busy 409 | 3 |
| Settings 顶栏与表单 | 4 |
| guard 本地指引文案 | 4 |
| webhook 只读 | 4 |
| Models → Settings 链接 | 5 |
| setup-and-launch 文档 | 5 |
| 非目标：Discord、改 yml | — |

## Self-review notes

- `startHost` 必须把 `runtimeRef` 传入所有使用 `ctx` 的 handler；漏改会导致 reload 后仍用旧 ctx。
- `loadOrCreateToken` 与 `writeCredentialsStore` 共用文件：PUT 时保留 `hostToken`。
- Desktop 空 apiKey 提交不传字段；仅「清除密钥」传 `apiKey: ""`。
- 现有 `readCredentials(homeDir).chatApiKey` 测试（redact）仍须绿。
