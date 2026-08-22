# FlintLoom Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `@flintloom/skill` 从 yml 挂载后，Agent 用 `skill`（`list` / `read`）读个人与工作区 `SKILL.md`；正文只经 `tool/result` 进 session。

**Architecture:** 新 Loom 包。`apply` 只 `require("tools")` 并登记一个工具。每次 `execute` 现扫 `homeDir/.flintloom/skills` 与工作区 `skills/`，工作区按目录 id 覆盖。host 只 overlay `homeDir`，不 import 该包。不改 `runTurn`、桌面、HTTP。

**Tech Stack:** 现有 kernel / tools、`yaml`（与 `@flintloom/kernel` 同 `^2.7.0`）、Vitest。不加字体、网络、新运行时。

## Global Constraints

- 产品名 FlintLoom；包前缀 `@flintloom/*`。禁止往 `createRuntime` 里 `register`。
- 不 import / submodule / 拷贝 dataagent-v3、deepseek-harness、Cordis。
- 不做 HTTP、桌面页、skill 写入、执行脚本、系统提示注入、MCP。
- `apps/host/src` 不得出现 `@flintloom/skill`、`createSkillTool`（连 `import type` 也不要）。
- 工具参数禁止名为 `path`。失败文案不得含绝对 `homeDir` / API key / token。
- 测试只写临时目录，不写开发者真·家目录。
- Windows：指定文件 `git add`；不要 `git add -A`。不要提交 `check_libs.py`、`scripts/desktop-dev.ts`。PowerShell 用 `git commit -m @"` / `"@`，不要 bash heredoc 的 `EOF` 行。不要用 `&&`。
- Spec：`docs/superpowers/specs/2026-08-22-flintloom-skill-design.md`

## File map

```text
packages/skill/package.json
packages/skill/src/parse.ts          # parseSkillMarkdown
packages/skill/src/scan.ts           # scanSkills, lookupSkill
packages/skill/src/tool.ts           # createSkillTool
packages/skill/src/index.ts          # default apply
packages/skill/tests/parse.test.ts
packages/skill/tests/scan.test.ts
packages/skill/tests/tool.test.ts
packages/skill/tests/plugin.test.ts

flintloom.yml
package.json                         # devDependency @flintloom/skill
pnpm-lock.yaml                       # pnpm install
apps/host/src/server.ts              # overlay homeDir
apps/host/tests/assembly.ts          # skill 行
apps/host/tests/server.test.ts       # 禁 import + omit skill
```

不改 desktop、loop、DocForge、通道。

---

### Task 1: 解析 `SKILL.md` 与扫盘

**Files:**
- Create: `packages/skill/package.json`
- Create: `packages/skill/src/parse.ts`
- Create: `packages/skill/src/scan.ts`
- Create: `packages/skill/tests/parse.test.ts`
- Create: `packages/skill/tests/scan.test.ts`

**Interfaces:**
- Consumes: `yaml.parse`、`isPluginId`（`@flintloom/kernel`）、`isHiddenRelPath` / `resolveInside` / `WorkspaceEscapeError`（`@flintloom/tools`）
- Produces:

```ts
export const SKILL_MAX_BYTES = 800_000;
export const SKILL_MAX_CHARS = 200_000;
export const SKILL_NAME_MAX = 80;
export const SKILL_DESCRIPTION_MAX = 500;

export type SkillSource = "home" | "workspace";
export type SkillRecord = {
  id: string;
  name: string;
  description: string;
  source: SkillSource;
  body: string;
};
export type SkillLookup =
  | { ok: true; record: SkillRecord }
  | { ok: false; reason: "not found" | "bad skill" | "too large" };

export function parseSkillMarkdown(raw: string): {
  name: string;
  description: string;
  body: string;
};

export function scanSkills(input: {
  homeDir: string;
  workspaceRoot: string;
}): SkillRecord[];

export function lookupSkill(input: {
  homeDir: string;
  workspaceRoot: string;
  id: string;
}): SkillLookup;
```

- [ ] **Step 1: Write the failing tests**

`packages/skill/package.json`：

```json
{
  "name": "@flintloom/skill",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@flintloom/kernel": "workspace:*",
    "@flintloom/tools": "workspace:*",
    "yaml": "^2.7.0"
  }
}
```

`packages/skill/tests/parse.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import {
  SKILL_DESCRIPTION_MAX,
  parseSkillMarkdown,
} from "../src/parse.ts";

describe("parseSkillMarkdown", () => {
  it("reads name description and body after the fence", () => {
    const parsed = parseSkillMarkdown(
      "---\nname: Demo\ndescription: A demo skill\n---\n# Hello\n",
    );
    expect(parsed).toEqual({
      name: "Demo",
      description: "A demo skill",
      body: "# Hello\n",
    });
  });

  it("accepts BOM and CRLF fences", () => {
    const parsed = parseSkillMarkdown(
      "\uFEFF---\r\nname: X\r\ndescription: Y\r\n---\r\nbody",
    );
    expect(parsed.name).toBe("X");
    expect(parsed.description).toBe("Y");
    expect(parsed.body).toBe("body");
  });

  it("rejects missing fence empty name and overlong description", () => {
    expect(() => parseSkillMarkdown("# no fence\n")).toThrow(/bad skill/);
    expect(() =>
      parseSkillMarkdown("---\nname: \ndescription: Y\n---\n"),
    ).toThrow(/bad skill/);
    expect(() =>
      parseSkillMarkdown(
        `---\nname: N\ndescription: ${"d".repeat(SKILL_DESCRIPTION_MAX + 1)}\n---\n`,
      ),
    ).toThrow(/bad skill/);
  });
});
```

`packages/skill/tests/scan.test.ts`：

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lookupSkill, scanSkills } from "../src/scan.ts";

function writeSkill(dir: string, id: string, body = `# ${id}\n`): void {
  const skillDir = join(dir, id);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, "SKILL.md"),
    `---\nname: ${id}\ndescription: desc ${id}\n---\n${body}`,
    "utf8",
  );
}

describe("scanSkills and lookupSkill", () => {
  it("merges home and workspace and overlays by directory id", () => {
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-skill-home-"));
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-skill-ws-"));
    writeSkill(join(homeDir, ".flintloom", "skills"), "alpha");
    writeSkill(join(homeDir, ".flintloom", "skills"), "shared", "home body\n");
    writeSkill(join(workspaceRoot, "skills"), "shared", "ws body\n");
    writeSkill(join(workspaceRoot, "skills"), "beta");
    mkdirSync(join(homeDir, ".flintloom", "skills", "node_modules"), {
      recursive: true,
    });

    const listed = scanSkills({ homeDir, workspaceRoot });
    expect(listed.map((s) => s.id)).toEqual(["alpha", "beta", "shared"]);
    expect(listed.find((s) => s.id === "shared")).toMatchObject({
      source: "workspace",
      body: "ws body\n",
    });

    mkdirSync(join(workspaceRoot, "skills", "alpha"), { recursive: true });
    writeFileSync(join(workspaceRoot, "skills", "alpha", "SKILL.md"), "not-yaml", "utf8");
    expect(scanSkills({ homeDir, workspaceRoot }).map((s) => s.id)).toEqual([
      "beta",
      "shared",
    ]);
    expect(lookupSkill({ homeDir, workspaceRoot, id: "alpha" })).toEqual({
      ok: false,
      reason: "bad skill",
    });
    expect(lookupSkill({ homeDir, workspaceRoot, id: "shared" })).toMatchObject({
      ok: true,
      record: { source: "workspace", body: "ws body\n" },
    });
    expect(lookupSkill({ homeDir, workspaceRoot, id: "missing" })).toEqual({
      ok: false,
      reason: "not found",
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run packages/skill/tests/parse.test.ts packages/skill/tests/scan.test.ts`

Expected: FAIL（模块不存在或导出未定义）。

- [ ] **Step 3: Minimal implementation**

`packages/skill/src/parse.ts`：

```ts
import { parse } from "yaml";

export const SKILL_MAX_BYTES = 800_000;
export const SKILL_MAX_CHARS = 200_000;
export const SKILL_NAME_MAX = 80;
export const SKILL_DESCRIPTION_MAX = 500;

export type SkillSource = "home" | "workspace";
export type SkillRecord = {
  id: string;
  name: string;
  description: string;
  source: SkillSource;
  body: string;
};
export type SkillLookup =
  | { ok: true; record: SkillRecord }
  | { ok: false; reason: "not found" | "bad skill" | "too large" };

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function asTrimmedString(value: unknown, max: number): string {
  if (typeof value !== "string") {
    throw new Error("bad skill");
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) {
    throw new Error("bad skill");
  }
  return trimmed;
}

export function parseSkillMarkdown(raw: string): {
  name: string;
  description: string;
  body: string;
} {
  const text = raw.startsWith("\uFEFF") ? raw.slice(1) : raw;
  const match = FENCE.exec(text);
  if (match === null || match[1] === undefined) {
    throw new Error("bad skill");
  }
  const header: unknown = parse(match[1]);
  if (header === null || typeof header !== "object" || Array.isArray(header)) {
    throw new Error("bad skill");
  }
  const rec = header as Record<string, unknown>;
  const name = asTrimmedString(rec.name, SKILL_NAME_MAX);
  const description = asTrimmedString(rec.description, SKILL_DESCRIPTION_MAX);
  const body = text.slice(match[0].length);
  if (body.length > SKILL_MAX_CHARS) {
    throw new Error("too large");
  }
  return { name, description, body };
}
```

`packages/skill/src/scan.ts`：

```ts
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { isPluginId } from "@flintloom/kernel";
import {
  isHiddenRelPath,
  resolveInside,
  WorkspaceEscapeError,
} from "@flintloom/tools";
import {
  SKILL_MAX_BYTES,
  parseSkillMarkdown,
} from "./parse.ts";
import type { SkillLookup, SkillRecord, SkillSource } from "./parse.ts";

export type { SkillLookup, SkillRecord, SkillSource } from "./parse.ts";

function readRecord(
  absPath: string,
  id: string,
  source: SkillSource,
): SkillLookup {
  if (!existsSync(absPath)) {
    return { ok: false, reason: "not found" };
  }
  const st = statSync(absPath);
  if (!st.isFile() || st.size > SKILL_MAX_BYTES) {
    return { ok: false, reason: st.isFile() ? "too large" : "bad skill" };
  }
  try {
    const parsed = parseSkillMarkdown(readFileSync(absPath, "utf8"));
    return {
      ok: true,
      record: { id, source, name: parsed.name, description: parsed.description, body: parsed.body },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    return { ok: false, reason: message === "too large" ? "too large" : "bad skill" };
  }
}

function workspaceAbs(workspaceRoot: string, id: string): string | undefined {
  try {
    return resolveInside(workspaceRoot, `skills/${id}/SKILL.md`);
  } catch (err) {
    if (err instanceof WorkspaceEscapeError) {
      return undefined;
    }
    throw err;
  }
}

function childDirs(root: string): string[] {
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    return [];
  }
  return readdirSync(root).filter((name) => {
    if (!isPluginId(name) || isHiddenRelPath(name)) {
      return false;
    }
    return statSync(join(root, name)).isDirectory();
  });
}

export function lookupSkill(input: {
  homeDir: string;
  workspaceRoot: string;
  id: string;
}): SkillLookup {
  const wsDir = join(input.workspaceRoot, "skills", input.id);
  if (existsSync(wsDir) && statSync(wsDir).isDirectory()) {
    const abs = workspaceAbs(input.workspaceRoot, input.id);
    if (abs === undefined) {
      return { ok: false, reason: "not found" };
    }
    return readRecord(abs, input.id, "workspace");
  }
  return readRecord(
    join(input.homeDir, ".flintloom", "skills", input.id, "SKILL.md"),
    input.id,
    "home",
  );
}

export function scanSkills(input: {
  homeDir: string;
  workspaceRoot: string;
}): SkillRecord[] {
  const map = new Map<string, SkillRecord>();
  const homeRoot = join(input.homeDir, ".flintloom", "skills");
  for (const id of childDirs(homeRoot)) {
    const looked = readRecord(join(homeRoot, id, "SKILL.md"), id, "home");
    if (looked.ok) {
      map.set(id, looked.record);
    }
  }
  const wsRoot = join(input.workspaceRoot, "skills");
  for (const id of childDirs(wsRoot)) {
    map.delete(id);
    const looked = lookupSkill({ ...input, id });
    if (looked.ok) {
      map.set(id, looked.record);
    }
  }
  return [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run packages/skill/tests/parse.test.ts packages/skill/tests/scan.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add packages/skill/package.json packages/skill/src/parse.ts packages/skill/src/scan.ts packages/skill/tests/parse.test.ts packages/skill/tests/scan.test.ts
git commit -m @"
feat: parse and scan local SKILL.md catalogs
"@
```

---

### Task 2: `skill` 工具

**Files:**
- Create: `packages/skill/src/tool.ts`
- Create: `packages/skill/tests/tool.test.ts`

**Interfaces:**
- Consumes: `scanSkills`、`lookupSkill`、`isPluginId`、`ToolDefinition`
- Produces: `createSkillTool({ homeDir: string }): ToolDefinition`，`name === "skill"`

- [ ] **Step 1: Write the failing test**

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSkillTool } from "../src/tool.ts";

function exec(workspaceRoot: string, signal = new AbortController().signal) {
  return { workspaceRoot, signal, channel: "cli" };
}

function writeSkill(root: string, id: string, body: string): void {
  mkdirSync(join(root, id), { recursive: true });
  writeFileSync(
    join(root, id, "SKILL.md"),
    `---\nname: ${id}\ndescription: d ${id}\n---\n${body}`,
    "utf8",
  );
}

describe("skill tool", () => {
  it("lists without bodies and reads workspace overlay", async () => {
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-skill-tool-home-"));
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-skill-tool-ws-"));
    writeSkill(join(homeDir, ".flintloom", "skills"), "shared", "home\n");
    writeSkill(join(workspaceRoot, "skills"), "shared", "ws\n");
    const tool = createSkillTool({ homeDir });
    expect(tool.name).toBe("skill");
    expect(tool.parameters).not.toHaveProperty("path");

    const listed = JSON.parse(
      await tool.execute({ action: "list" }, exec(workspaceRoot)),
    ) as { skills: { id: string; source: string; body?: string }[] };
    expect(listed.skills).toEqual([
      { id: "shared", name: "shared", description: "d shared", source: "workspace" },
    ]);
    expect(listed.skills[0]).not.toHaveProperty("body");

    const read = JSON.parse(
      await tool.execute({ action: "read", id: "shared" }, exec(workspaceRoot)),
    ) as { body: string; source: string };
    expect(read).toMatchObject({ body: "ws\n", source: "workspace" });
    expect(JSON.stringify(read)).not.toContain(homeDir);

    expect(await tool.execute({}, exec(workspaceRoot))).toBe("failed: missing action");
    expect(await tool.execute({ action: "write" }, exec(workspaceRoot))).toBe(
      "failed: unknown action",
    );
    expect(await tool.execute({ action: "read" }, exec(workspaceRoot))).toBe(
      "failed: missing id",
    );
    expect(await tool.execute({ action: "read", id: "nope" }, exec(workspaceRoot))).toBe(
      "failed: not found",
    );
    const ac = new AbortController();
    ac.abort();
    expect(await tool.execute({ action: "list" }, exec(workspaceRoot, ac.signal))).toBe(
      "aborted",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/skill/tests/tool.test.ts`

Expected: FAIL（`createSkillTool` 未定义）。

- [ ] **Step 3: Minimal implementation**

`packages/skill/src/tool.ts`：

```ts
import { isPluginId } from "@flintloom/kernel";
import type { ToolDefinition } from "@flintloom/tools";
import { lookupSkill, scanSkills } from "./scan.ts";

export function createSkillTool(opts: { homeDir: string }): ToolDefinition {
  return {
    name: "skill",
    description:
      "List or read local skills. Use action list, or action read with id.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "read"] },
        id: { type: "string" },
      },
      required: ["action"],
    },
    async execute(args, exec) {
      if (exec.signal.aborted) {
        return "aborted";
      }
      if (typeof args.action !== "string") {
        return "failed: missing action";
      }
      if (args.action === "list") {
        const skills = scanSkills({
          homeDir: opts.homeDir,
          workspaceRoot: exec.workspaceRoot,
        }).map(({ body: _body, ...rest }) => rest);
        return JSON.stringify({ skills });
      }
      if (args.action !== "read") {
        return "failed: unknown action";
      }
      if (typeof args.id !== "string" || !isPluginId(args.id)) {
        return "failed: missing id";
      }
      const looked = lookupSkill({
        homeDir: opts.homeDir,
        workspaceRoot: exec.workspaceRoot,
        id: args.id,
      });
      if (!looked.ok) {
        return `failed: ${looked.reason}`;
      }
      return JSON.stringify(looked.record);
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/skill/tests/tool.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add packages/skill/src/tool.ts packages/skill/tests/tool.test.ts
git commit -m @"
feat: add skill list and read tool
"@
```

---

### Task 3: 插件组装、yml、host overlay

**Files:**
- Create: `packages/skill/src/index.ts`
- Create: `packages/skill/tests/plugin.test.ts`
- Modify: `flintloom.yml`（`loop` 前插入 skill 行）
- Modify: `package.json`（`devDependencies` 加 `"@flintloom/skill": "workspace:*"`）
- Modify: `apps/host/src/server.ts`（`runtimeConfigById.skill = { homeDir }`）
- Modify: `apps/host/tests/assembly.ts`
- Modify: `apps/host/tests/server.test.ts`（禁 import；省略 skill 行则 schema 无 `skill`）
- Test: `pnpm install` 更新 lockfile

**Interfaces:**
- Consumes: Task 2 的 `createSkillTool`
- Produces: default export `{ name: "@flintloom/skill", apply }`；`ASSEMBLY` / 根 yml 含 skill 行

- [ ] **Step 1: Write the failing tests**

`packages/skill/tests/plugin.test.ts`：

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Context } from "@flintloom/kernel";
import modelsPlugin from "@flintloom/models";
import toolsPlugin, { type ToolRegistry } from "@flintloom/tools";
import plugin from "../src/index.ts";

describe("skill plugin", () => {
  it("registers skill and dispose removes it", () => {
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-skill-plug-"));
    const ctx = new Context();
    ctx.plugin(modelsPlugin);
    ctx.plugin(toolsPlugin);
    const stop = ctx.plugin(plugin, { homeDir });
    const tools = ctx.require<ToolRegistry>("tools");
    expect(tools.schemas().map((s) => s.name)).toContain("skill");
    stop();
    expect(tools.schemas().map((s) => s.name)).not.toContain("skill");
    expect(() =>
      tools.execute("skill", { action: "list" }, {
        workspaceRoot: homeDir,
        signal: new AbortController().signal,
        channel: "cli",
      }),
    ).toThrow(/not registered/);
  });
});
```

在 `apps/host/tests/server.test.ts` 的 `host src does not import tool factories` 末尾追加：

```ts
    expect(src).not.toMatch(/@flintloom\/skill/);
    expect(src).not.toMatch(/createSkillTool/);
```

在同一文件、`omitting docforge` 那个 `it` 附近追加：

```ts
  it("omitting skill from yml omits the skill tool", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-host-noskill-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-host-home-"));
    writeFileSync(
      join(workspaceRoot, "flintloom.yml"),
      ASSEMBLY.replace(
        `  - id: skill\n    name: "@flintloom/skill"\n`,
        "",
      ),
    );
    const { ctx } = await createRuntime(workspaceRoot, homeDir);
    const names = ctx.require<ToolRegistry>("tools").schemas().map((s) => s.name);
    expect(names).not.toContain("skill");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run packages/skill/tests/plugin.test.ts apps/host/tests/server.test.ts`

Expected: FAIL（无 default export / `ASSEMBLY` 还没有 skill 行，replace 后 schema 若将来有 skill 才会红；先红在 plugin import）。

- [ ] **Step 3: Minimal wiring**

`packages/skill/src/index.ts`：

```ts
import { homedir } from "node:os";
import type { Context, FlintPlugin } from "@flintloom/kernel";
import type { ToolRegistry } from "@flintloom/tools";
import { parseSkillMarkdown } from "./parse.ts";
import { lookupSkill, scanSkills } from "./scan.ts";
import { createSkillTool } from "./tool.ts";

function homeDirFromConfig(config: Record<string, unknown>): string {
  return typeof config.homeDir === "string" && config.homeDir.length > 0
    ? config.homeDir
    : homedir();
}

const plugin: FlintPlugin = {
  name: "@flintloom/skill",
  apply(ctx: Context, config: Record<string, unknown>) {
    const tools = ctx.require<ToolRegistry>("tools");
    ctx.effect(tools.register(createSkillTool({ homeDir: homeDirFromConfig(config) })));
  },
};

export type { SkillLookup, SkillRecord, SkillSource } from "./parse.ts";
export { parseSkillMarkdown } from "./parse.ts";
export { lookupSkill, scanSkills } from "./scan.ts";
export { createSkillTool } from "./tool.ts";
export default plugin;
```

根 `flintloom.yml` 与 `apps/host/tests/assembly.ts` 都在 `loop` 行之前插入：

```yaml
  - id: skill
    name: "@flintloom/skill"
```

`apps/host/src/server.ts` 在 `runtimeConfigById.knowledge = { ... }` 之后加：

```ts
  runtimeConfigById.skill = {
    homeDir,
  };
```

根 `package.json` 的 `devDependencies` 按字母序插入：

```json
    "@flintloom/skill": "workspace:*",
```

然后在仓库根运行 `pnpm install`（更新 lockfile）。不要手改 lockfile。

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run packages/skill apps/host/tests/server.test.ts`

Expected: PASS。

Run: `pnpm test`

Expected: 全部 PASS。

Run: `pnpm typecheck`

Expected: exit 0。

- [ ] **Step 5: Commit**

```powershell
git add packages/skill/src/index.ts packages/skill/tests/plugin.test.ts flintloom.yml package.json pnpm-lock.yaml apps/host/src/server.ts apps/host/tests/assembly.ts apps/host/tests/server.test.ts
git commit -m @"
feat: load skill plugin from flintloom.yml
"@
```

不要 `git add` `scripts/desktop-dev.ts` 或 `check_libs.py`。

---

## Spec coverage

| Spec | Task |
|---|---|
| `parseSkillMarkdown` 头/BOM/CRLF/坏文件 | 1 |
| `scanSkills` 合并、目录覆盖、隐藏 id | 1 |
| `lookupSkill` 不回落个人 | 1 |
| `skill` list/read 与失败文案、无 `path` 参数 | 2 |
| `apply` + dispose + yml/ASSEMBLY + overlay | 3 |
| host 不 import 包 | 3 |
| 去掉 yml 行则无工具 | 3 |
| `pnpm test` / `typecheck` | 3 |
| 无 HTTP / 桌面 / `runTurn` | 全任务未列入那些文件 |
