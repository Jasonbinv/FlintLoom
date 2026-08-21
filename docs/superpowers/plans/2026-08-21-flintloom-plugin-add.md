# FlintLoom `flint plugin add` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `flint plugin add [--id] <path>` 把本地插件目录拷进 `homeDir/.flintloom/plugins/<id>`，验证入口有 `apply`，再在工作区 `flintloom.yml` 末尾加一行；`applyConfig` 对绝对路径 `name` 走 file URL `import`。

**Architecture:** kernel 新增 `resolvePluginEntry` / `defaultImport` / `installPluginFromPath`。`applyConfig` 缺省 `importFn` 改为 `defaultImport`（绝对路径 → 入口文件 `pathToFileURL`；否则 `import(name)`）。CLI 抽出 `parseCliArgv` + `runCli`：`plugin add` 只调安装器，禁止 `createRuntime`。Host **不**改路由、**不**调用安装器；下次 boot 因默认 importFn 自动加载绝对路径插件。

**Tech Stack:** 现有 `@flintloom/kernel`（`yaml`、`unwrapPlugin`、`loadConfig`）、`apps/cli`、Node `fs` / `path` / `url` / `crypto`。不新增 npm 依赖。不访问网络。

## Global Constraints

- 产品名 FlintLoom；包前缀 `@flintloom/*`。禁止新 Loom 包。禁止往 `createRuntime` 里 `register`。
- 不 import / submodule / 拷贝 dataagent-v3、deepseek-harness、Cordis。
- 本片只做本地 path。不做 git / npm、`plugin list`/`remove`、HTTP 安装、桌面插件页。
- 不改仓库根 `flintloom.yml`、host `ASSEMBLY`、`apps/host/src`。
- 验收与测试入口用 **`index.mjs`**（ESM）。不要用无 `"type": "module"` 的 `index.js` + `export default`。
- 缺 `flintloom.yml` → `throw new Error("plugins")`，与 `createRuntime` 相同。
- `Error.message` 不得含 API key / host token / 插件源码全文。
- 验证只 `import` + `unwrapPlugin`，不 `new Context()`、不调用 `apply`。
- Windows：指定文件 `git add`；不要 `git add -A`。不要提交 `check_libs.py`、`scripts/desktop-dev.ts`。PowerShell 用 `git commit -m @"` / `"@`，**不要** bash heredoc 的 `EOF` 行。
- Spec：`docs/superpowers/specs/2026-08-21-flintloom-plugin-add-design.md`

## File map

```text
packages/kernel/src/plugin-entry.ts          # isPluginId, resolvePluginEntry, defaultImport
packages/kernel/src/install-plugin.ts        # installPluginFromPath
packages/kernel/src/apply-config.ts          # 缺省 importFn = defaultImport
packages/kernel/src/index.ts                 # 导出新 API
packages/kernel/tests/plugin-entry.test.ts
packages/kernel/tests/apply-config.test.ts   # 追加绝对路径用例
packages/kernel/tests/install-plugin.test.ts

apps/cli/src/argv.ts                         # parseCliArgv
apps/cli/src/run.ts                          # runCli
apps/cli/src/bin.ts                          # 调 runCli 后 process.exit
apps/cli/src/output.ts                       # 不改
apps/cli/tests/cli.test.ts                   # 追加 argv / runCli
apps/cli/package.json                        # 直接依赖 @flintloom/kernel
pnpm-lock.yaml                               # pnpm install
```

不改 desktop、DocForge、通道、默认插件列表。

---

### Task 1: 绝对路径 `import` + `resolvePluginEntry`

**Files:**
- Create: `packages/kernel/src/plugin-entry.ts`
- Create: `packages/kernel/tests/plugin-entry.test.ts`
- Modify: `packages/kernel/src/apply-config.ts`
- Modify: `packages/kernel/src/index.ts`
- Modify: `packages/kernel/tests/apply-config.test.ts`
- Test: `packages/kernel/tests/plugin-entry.test.ts`、`packages/kernel/tests/apply-config.test.ts`

**Interfaces:**
- Consumes: 现有 `unwrapPlugin`、`applyConfig`、`Context`
- Produces:

```ts
export function isPluginId(id: string): boolean;

export function resolvePluginEntry(dir: string): string;

export function defaultImport(name: string): Promise<unknown>;
```

`applyConfig` 在未传入 `importFn` 时必须调用 `defaultImport`。本任务 **还不** 实现 `installPluginFromPath`，**还不** 改 CLI。

- [ ] **Step 1: Write the failing tests**

创建 `packages/kernel/tests/plugin-entry.test.ts`：

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isPluginId, resolvePluginEntry } from "../src/index.ts";

const APPLY_MJS = `export default {
  name: "inside",
  apply() {},
};
`;

describe("isPluginId", () => {
  it("rejects empty, dots, and separators", () => {
    expect(isPluginId("ok")).toBe(true);
    expect(isPluginId("")).toBe(false);
    expect(isPluginId(".")).toBe(false);
    expect(isPluginId("..")).toBe(false);
    expect(isPluginId("a/b")).toBe(false);
    expect(isPluginId("a\\b")).toBe(false);
  });
});

describe("resolvePluginEntry", () => {
  it("uses index.mjs when there is no package.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-entry-mjs-"));
    writeFileSync(join(dir, "index.mjs"), APPLY_MJS);
    expect(resolvePluginEntry(dir)).toBe(join(dir, "index.mjs"));
  });

  it("prefers package.json main when the file stays inside dir", () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-entry-main-"));
    writeFileSync(join(dir, "plugin.mjs"), APPLY_MJS);
    writeFileSync(join(dir, "index.mjs"), APPLY_MJS);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ main: "./plugin.mjs" }),
    );
    expect(resolvePluginEntry(dir)).toBe(join(dir, "plugin.mjs"));
  });

  it("skips main that realpath-escapes and falls through to index.mjs", () => {
    const parent = mkdtempSync(join(tmpdir(), "flintloom-entry-esc-"));
    const dir = join(parent, "plug");
    const outside = join(parent, "out");
    mkdirSync(dir);
    mkdirSync(outside);
    writeFileSync(join(outside, "x.mjs"), APPLY_MJS);
    writeFileSync(join(dir, "index.mjs"), APPLY_MJS);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ main: "../out/x.mjs" }),
    );
    expect(resolvePluginEntry(dir)).toBe(join(dir, "index.mjs"));
  });

  it("ignores invalid package.json and uses index.mjs", () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-entry-badjson-"));
    writeFileSync(join(dir, "package.json"), "{");
    writeFileSync(join(dir, "index.mjs"), APPLY_MJS);
    expect(resolvePluginEntry(dir)).toBe(join(dir, "index.mjs"));
  });

  it("throws entry when the directory has no entry file", () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-entry-none-"));
    expect(() => resolvePluginEntry(dir)).toThrow(/entry/);
  });
});
```

在 `packages/kernel/tests/apply-config.test.ts` **追加**（保留现有 importFn 用例；在文件顶部现有 import 旁增加 `mkdirSync, mkdtempSync, writeFileSync` from `node:fs`，`tmpdir` from `node:os`，`join` from `node:path`）：

```ts
  it("默认 importFn 从绝对路径目录加载 apply", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-abs-plugin-"));
    writeFileSync(
      join(dir, "index.mjs"),
      `export default {
  name: "plugin-add-test",
  apply(ctx) {
    ctx.provide("plugin-add-test", 1);
  },
};
`,
    );
    const ctx = new Context();
    const stop = await applyConfig(ctx, {
      plugins: [{ id: "plugin-add-test", name: dir }],
    });
    expect(ctx.require("plugin-add-test")).toBe(1);
    stop();
  });
```

不要给这个用例传 `importFn`。

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run packages/kernel/tests/plugin-entry.test.ts packages/kernel/tests/apply-config.test.ts`

Expected: FAIL（`isPluginId` / `resolvePluginEntry` 未导出；绝对路径用例因 `import(dir)` 失败或挂不上 provide）。

- [ ] **Step 3: Implement plugin-entry and default importFn**

创建 `packages/kernel/src/plugin-entry.ts`：

```ts
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export function isPluginId(id: string): boolean {
  return (
    id.length > 0 &&
    id !== "." &&
    id !== ".." &&
    !id.includes("/") &&
    !id.includes("\\")
  );
}

function isInsideDir(dir: string, candidate: string): boolean {
  const root = realpathSync(dir);
  const full = realpathSync(candidate);
  const prefix = root.endsWith(sep) ? root : root + sep;
  return full === root || full.startsWith(prefix);
}

export function resolvePluginEntry(dir: string): string {
  if (!statSync(dir).isDirectory()) {
    throw new Error("entry");
  }
  const pkgPath = join(dir, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(pkgPath, "utf8"));
      if (parsed !== null && typeof parsed === "object") {
        const rec = parsed as Record<string, unknown>;
        for (const key of ["main", "module"] as const) {
          const field = rec[key];
          if (typeof field !== "string" || field.length === 0) {
            continue;
          }
          const resolved = resolve(dir, field);
          if (
            existsSync(resolved) &&
            statSync(resolved).isFile() &&
            isInsideDir(dir, resolved)
          ) {
            return realpathSync(resolved);
          }
        }
      }
    } catch {
      // invalid JSON: fall through to index.*
    }
  }
  for (const name of ["index.js", "index.mjs", "index.ts"]) {
    const candidate = join(dir, name);
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return realpathSync(candidate);
    }
  }
  throw new Error("entry");
}

export async function defaultImport(name: string): Promise<unknown> {
  if (!isAbsolute(name)) {
    return import(name);
  }
  const spec = statSync(name).isDirectory()
    ? resolvePluginEntry(name)
    : name;
  return import(pathToFileURL(spec).href);
}
```

`packages/kernel/src/apply-config.ts`：增加 `import { defaultImport } from "./plugin-entry.ts";`，把

```ts
const importFn = opts?.importFn ?? ((n: string) => import(n));
```

改成

```ts
const importFn = opts?.importFn ?? defaultImport;
```

`packages/kernel/src/index.ts` 增加导出：

```ts
export {
  defaultImport,
  isPluginId,
  resolvePluginEntry,
} from "./plugin-entry.ts";
```

Windows 上 `resolvePluginEntry` 返回的 `realpathSync` 可能与 `join(dir, "index.mjs")` 盘符大小写不同。若 Step 2 的 `toBe(join(...))` 因此失败，测试改为：

```ts
expect(resolvePluginEntry(dir)).toBe(realpathSync(join(dir, "index.mjs")));
```

并在测试文件 `import { realpathSync } from "node:fs"`。不要放宽 `isInsideDir`。

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run packages/kernel/tests/plugin-entry.test.ts packages/kernel/tests/apply-config.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add packages/kernel/src/plugin-entry.ts packages/kernel/src/apply-config.ts packages/kernel/src/index.ts packages/kernel/tests/plugin-entry.test.ts packages/kernel/tests/apply-config.test.ts
git commit -m @"
feat: import flintloom plugins from absolute paths
"@
```

---

### Task 2: `installPluginFromPath`

**Files:**
- Create: `packages/kernel/src/install-plugin.ts`
- Create: `packages/kernel/tests/install-plugin.test.ts`
- Modify: `packages/kernel/src/index.ts`
- Test: `packages/kernel/tests/install-plugin.test.ts`

**Interfaces:**
- Consumes: `isPluginId`、`resolvePluginEntry`、`defaultImport`、`unwrapPlugin`、`loadConfig`
- Produces:

```ts
export type InstallPluginFromPathInput = {
  workspaceRoot: string;
  homeDir: string;
  sourcePath: string;
  id?: string;
};

export async function installPluginFromPath(
  input: InstallPluginFromPathInput,
): Promise<{ id: string; dest: string }>;
```

不写 stdout。不调用 `apply`。不改 CLI。

- [ ] **Step 1: Write the failing tests**

创建 `packages/kernel/tests/install-plugin.test.ts`：

```ts
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyConfig,
  Context,
  installPluginFromPath,
  loadConfig,
} from "../src/index.ts";

const APPLY_MJS = `export default {
  name: "sample",
  apply(ctx) {
    ctx.provide("plugin-add-test", 1);
  },
};
`;

function writePlugin(dir: string, source: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.mjs"), source);
}

function writeYml(workspace: string, text = "plugins: []\n"): void {
  writeFileSync(join(workspace, "flintloom.yml"), text);
}

describe("installPluginFromPath", () => {
  it("copies the bundle, appends yml, and applyConfig loads it", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-add-ws-"));
    const home = mkdtempSync(join(tmpdir(), "flintloom-add-home-"));
    const source = mkdtempSync(join(tmpdir(), "flintloom-add-src-"));
    writePlugin(source, APPLY_MJS);
    writeYml(workspace);
    mkdirSync(join(source, "node_modules"));
    writeFileSync(join(source, "node_modules", "ignored.js"), "nope");

    const { id, dest } = await installPluginFromPath({
      workspaceRoot: workspace,
      homeDir: home,
      sourcePath: source,
      id: "sample",
    });

    expect(id).toBe("sample");
    expect(dest).toBe(join(home, ".flintloom", "plugins", "sample"));
    expect(existsSync(join(dest, "index.mjs"))).toBe(true);
    expect(existsSync(join(dest, "node_modules"))).toBe(false);

    const config = loadConfig(
      readFileSync(join(workspace, "flintloom.yml"), "utf8"),
    );
    expect(config.plugins).toHaveLength(1);
    expect(config.plugins[0]).toEqual({ id: "sample", name: dest });

    const ctx = new Context();
    const stop = await applyConfig(ctx, config);
    expect(ctx.require("plugin-add-test")).toBe(1);
    stop();
  });

  it("defaults id to the source directory basename", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-add-base-ws-"));
    const home = mkdtempSync(join(tmpdir(), "flintloom-add-base-home-"));
    const parent = mkdtempSync(join(tmpdir(), "flintloom-add-base-parent-"));
    const source = join(parent, "myplug");
    writePlugin(source, APPLY_MJS);
    writeYml(workspace);
    const { id } = await installPluginFromPath({
      workspaceRoot: workspace,
      homeDir: home,
      sourcePath: source,
    });
    expect(id).toBe("myplug");
    expect(existsSync(join(home, ".flintloom", "plugins", "myplug", "index.mjs"))).toBe(
      true,
    );
  });

  it("refuses a duplicate id without changing dest", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-add-dup-ws-"));
    const home = mkdtempSync(join(tmpdir(), "flintloom-add-dup-home-"));
    const source = mkdtempSync(join(tmpdir(), "flintloom-add-dup-src-"));
    writePlugin(source, APPLY_MJS);
    writeYml(workspace);
    await installPluginFromPath({
      workspaceRoot: workspace,
      homeDir: home,
      sourcePath: source,
      id: "sample",
    });
    const dest = join(home, ".flintloom", "plugins", "sample");
    const yml = readFileSync(join(workspace, "flintloom.yml"), "utf8");
    await expect(
      installPluginFromPath({
        workspaceRoot: workspace,
        homeDir: home,
        sourcePath: source,
        id: "sample",
      }),
    ).rejects.toThrow(/id/);
    expect(readFileSync(join(workspace, "flintloom.yml"), "utf8")).toBe(yml);
    expect(existsSync(join(dest, "index.mjs"))).toBe(true);
  });

  it("refuses when dest exists even if yml lacks the id", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-add-dest-ws-"));
    const home = mkdtempSync(join(tmpdir(), "flintloom-add-dest-home-"));
    const source = mkdtempSync(join(tmpdir(), "flintloom-add-dest-src-"));
    writePlugin(source, APPLY_MJS);
    writeYml(workspace);
    mkdirSync(join(home, ".flintloom", "plugins", "sample"), {
      recursive: true,
    });
    await expect(
      installPluginFromPath({
        workspaceRoot: workspace,
        homeDir: home,
        sourcePath: source,
        id: "sample",
      }),
    ).rejects.toThrow(/id/);
    expect(readFileSync(join(workspace, "flintloom.yml"), "utf8")).toBe(
      "plugins: []\n",
    );
  });

  it("does not leave dest or yml changes when apply is missing", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-add-noapply-ws-"));
    const home = mkdtempSync(join(tmpdir(), "flintloom-add-noapply-home-"));
    const source = mkdtempSync(join(tmpdir(), "flintloom-add-noapply-src-"));
    writePlugin(source, "export default { name: 'x' };\n");
    writeYml(workspace);
    await expect(
      installPluginFromPath({
        workspaceRoot: workspace,
        homeDir: home,
        sourcePath: source,
        id: "sample",
      }),
    ).rejects.toThrow();
    expect(existsSync(join(home, ".flintloom", "plugins", "sample"))).toBe(
      false,
    );
    expect(readFileSync(join(workspace, "flintloom.yml"), "utf8")).toBe(
      "plugins: []\n",
    );
    const pluginsDir = join(home, ".flintloom", "plugins");
    if (existsSync(pluginsDir)) {
      expect(
        readdirSync(pluginsDir).filter((name) => name.includes(".tmp-")),
      ).toEqual([]);
    }
  });

  it("throws entry when the directory has no entry", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-add-empty-ws-"));
    const home = mkdtempSync(join(tmpdir(), "flintloom-add-empty-home-"));
    const source = mkdtempSync(join(tmpdir(), "flintloom-add-empty-src-"));
    writeYml(workspace);
    await expect(
      installPluginFromPath({
        workspaceRoot: workspace,
        homeDir: home,
        sourcePath: source,
        id: "sample",
      }),
    ).rejects.toThrow(/entry/);
  });

  it("throws plugins when flintloom.yml is missing", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-add-noyaml-ws-"));
    const home = mkdtempSync(join(tmpdir(), "flintloom-add-noyaml-home-"));
    const source = mkdtempSync(join(tmpdir(), "flintloom-add-noyaml-src-"));
    writePlugin(source, APPLY_MJS);
    await expect(
      installPluginFromPath({
        workspaceRoot: workspace,
        homeDir: home,
        sourcePath: source,
        id: "sample",
      }),
    ).rejects.toThrow(/plugins/);
  });

  it("throws path when the source is not a directory", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-add-file-ws-"));
    const home = mkdtempSync(join(tmpdir(), "flintloom-add-file-home-"));
    const source = mkdtempSync(join(tmpdir(), "flintloom-add-file-src-"));
    const file = join(source, "index.mjs");
    writePlugin(source, APPLY_MJS);
    writeYml(workspace);
    await expect(
      installPluginFromPath({
        workspaceRoot: workspace,
        homeDir: home,
        sourcePath: file,
        id: "sample",
      }),
    ).rejects.toThrow(/path/);
  });

  it("throws id when id contains a separator", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-add-badid-ws-"));
    const home = mkdtempSync(join(tmpdir(), "flintloom-add-badid-home-"));
    const source = mkdtempSync(join(tmpdir(), "flintloom-add-badid-src-"));
    writePlugin(source, APPLY_MJS);
    writeYml(workspace);
    await expect(
      installPluginFromPath({
        workspaceRoot: workspace,
        homeDir: home,
        sourcePath: source,
        id: "a/b",
      }),
    ).rejects.toThrow(/id/);
  });
});
```

第一例里 `expect(dest).toBe(join(...))` 若因 `realpath` 盘符失败，改为 `expect(dest).toBe(realpathSync(join(home, ".flintloom", "plugins", "sample")))`，并 `import { realpathSync } from "node:fs"`。yml 里的 `name` 必须是这个 `dest` 字符串。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/kernel/tests/install-plugin.test.ts`

Expected: FAIL（`installPluginFromPath` 未导出）。

- [ ] **Step 3: Implement installPluginFromPath**

创建 `packages/kernel/src/install-plugin.ts`：

```ts
import { randomBytes } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { isSeq, parseDocument } from "yaml";
import { unwrapPlugin } from "./apply-config.ts";
import { loadConfig } from "./config.ts";
import { defaultImport, isPluginId } from "./plugin-entry.ts";

export type InstallPluginFromPathInput = {
  workspaceRoot: string;
  homeDir: string;
  sourcePath: string;
  id?: string;
};

function hex8(): string {
  return randomBytes(8).toString("hex");
}

function realpathOrThrowPath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    throw new Error("path");
  }
}

function rmIfExists(p: string): void {
  rmSync(p, { recursive: true, force: true });
}

function replaceYmlAtomic(ymlPath: string, dumped: string): void {
  const hex = hex8();
  const tmp = `${ymlPath}.${hex}.tmp`;
  const bak = `${ymlPath}.bak-${hex}`;
  writeFileSync(tmp, dumped);
  try {
    renameSync(ymlPath, bak);
    try {
      renameSync(tmp, ymlPath);
    } catch (err) {
      try {
        renameSync(bak, ymlPath);
      } catch {
        // keep bak for recovery; still throw original
      }
      throw err;
    }
    rmIfExists(bak);
  } catch (err) {
    rmIfExists(tmp);
    throw err;
  }
}

export async function installPluginFromPath(
  input: InstallPluginFromPathInput,
): Promise<{ id: string; dest: string }> {
  const source = realpathOrThrowPath(input.sourcePath);
  if (!statSync(source).isDirectory()) {
    throw new Error("path");
  }
  const id = input.id ?? basename(source);
  if (!isPluginId(id)) {
    throw new Error("id");
  }

  const ymlPath = join(input.workspaceRoot, "flintloom.yml");
  if (!existsSync(ymlPath)) {
    throw new Error("plugins");
  }
  const ymlText = readFileSync(ymlPath, "utf8");
  const config = loadConfig(ymlText);
  if (config.plugins.some((row) => row.id === id)) {
    throw new Error("id");
  }

  const dest = join(input.homeDir, ".flintloom", "plugins", id);
  if (existsSync(dest)) {
    throw new Error("id");
  }

  const parent = join(input.homeDir, ".flintloom", "plugins");
  mkdirSync(parent, { recursive: true });
  const tmp = join(parent, `.${id}.tmp-${hex8()}`);

  try {
    cpSync(source, tmp, {
      recursive: true,
      filter: (src) => {
        const base = basename(src);
        return base !== "node_modules" && base !== ".git";
      },
    });
    const mod = await defaultImport(tmp);
    unwrapPlugin(mod, tmp);
    renameSync(tmp, dest);
  } catch (err) {
    rmIfExists(tmp);
    throw err;
  }

  const destAbs = realpathSync(dest);
  try {
    const doc = parseDocument(ymlText);
    const plugins = doc.get("plugins");
    if (!isSeq(plugins)) {
      throw new Error("plugins");
    }
    plugins.add({ id, name: destAbs });
    const dumped = String(doc);
    loadConfig(dumped);
    replaceYmlAtomic(ymlPath, dumped);
  } catch (err) {
    rmIfExists(dest);
    throw err;
  }

  return { id, dest: destAbs };
}
```

`packages/kernel/src/index.ts` 增加：

```ts
export {
  installPluginFromPath,
  type InstallPluginFromPathInput,
} from "./install-plugin.ts";
```

`replaceYmlAtomic` 的 catch 必须在 `rename(yml, bak)` 失败时删 tmp 且不碰 dest（此时 dest 已存在——外层 try 会 `rmIfExists(dest)`）。若 `rename(bak, yml)` 恢复失败，仍抛原始 err。

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run packages/kernel/tests/install-plugin.test.ts packages/kernel/tests/apply-config.test.ts packages/kernel/tests/plugin-entry.test.ts`

Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add packages/kernel/src/install-plugin.ts packages/kernel/src/index.ts packages/kernel/tests/install-plugin.test.ts
git commit -m @"
feat: install local plugin bundles into the profile
"@
```

---

### Task 3: `flint plugin add` CLI

**Files:**
- Create: `apps/cli/src/argv.ts`
- Create: `apps/cli/src/run.ts`
- Modify: `apps/cli/src/bin.ts`
- Modify: `apps/cli/package.json`
- Modify: `apps/cli/tests/cli.test.ts`
- Test: `apps/cli/tests/cli.test.ts`
- Also: 在 `apps/cli` 目录执行 `pnpm install`（会改根 `pnpm-lock.yaml`）

**Interfaces:**
- Consumes: `installPluginFromPath`、现有 `createRuntime`、`formatCliOutput`
- Produces:

```ts
export type CliTurnCommand = {
  kind: "turn";
  workspace: string;
  text: string;
};

export type CliPluginAddCommand = {
  kind: "plugin-add";
  workspace: string;
  sourcePath: string;
  id?: string;
};

export type CliCommand = CliTurnCommand | CliPluginAddCommand;

export function parseCliArgv(argv: string[], cwd: string): CliCommand;

export type CliDeps = {
  cwd: () => string;
  homedir: () => string;
  createRuntime: typeof createRuntime;
  installPluginFromPath: typeof installPluginFromPath;
  stdout: { write: (chunk: string) => void };
  stderr: { write: (chunk: string) => void };
};

export async function runCli(argv: string[], deps: CliDeps): Promise<number>;
```

`--workspace` 只在第一遍扫描里剥离（任意位置）。`--id` **只**在 `plugin add` 段解析。

- [ ] **Step 1: Write the failing tests**

在 `apps/cli/tests/cli.test.ts` **追加** import：`vi` from vitest；`parseCliArgv`、`runCli` from `../src/argv.ts` 与 `../src/run.ts`。保留现有 `loadOrCreateToken` / `formatCliOutput` 用例。

```ts
describe("parseCliArgv", () => {
  it("keeps turn text and --workspace", () => {
    expect(
      parseCliArgv(["--workspace", "W", "hello", "world"], "/cwd"),
    ).toEqual({ kind: "turn", workspace: "W", text: "hello world" });
    expect(parseCliArgv(["hello"], "/cwd")).toEqual({
      kind: "turn",
      workspace: "/cwd",
      text: "hello",
    });
  });

  it("parses plugin add with optional --id before or after the path", () => {
    expect(parseCliArgv(["plugin", "add", "./p"], "/cwd")).toEqual({
      kind: "plugin-add",
      workspace: "/cwd",
      sourcePath: "./p",
    });
    expect(
      parseCliArgv(["plugin", "add", "--id", "x", "./p"], "/cwd"),
    ).toEqual({
      kind: "plugin-add",
      workspace: "/cwd",
      sourcePath: "./p",
      id: "x",
    });
    expect(
      parseCliArgv(["--workspace", "W", "plugin", "add", "./p", "--id", "x"], "/cwd"),
    ).toEqual({
      kind: "plugin-add",
      workspace: "W",
      sourcePath: "./p",
      id: "x",
    });
  });

  it("throws plugin add when the plugin subcommand is not add", () => {
    expect(() => parseCliArgv(["plugin"], "/cwd")).toThrow(/plugin add/);
    expect(() => parseCliArgv(["plugin", "list"], "/cwd")).toThrow(/plugin add/);
  });

  it("throws id or path for bad plugin add argv", () => {
    expect(() => parseCliArgv(["plugin", "add"], "/cwd")).toThrow(/path/);
    expect(() => parseCliArgv(["plugin", "add", "--id"], "/cwd")).toThrow(/id/);
    expect(() =>
      parseCliArgv(["plugin", "add", "a", "b"], "/cwd"),
    ).toThrow(/path/);
    expect(() =>
      parseCliArgv(["plugin", "add", "--id", "x", "--id", "y", "./p"], "/cwd"),
    ).toThrow(/id/);
  });
});

describe("runCli", () => {
  it("plugin add does not call createRuntime", async () => {
    const createRuntime = vi.fn();
    const installPluginFromPath = vi.fn(async () => ({
      id: "sample",
      dest: "/dest",
    }));
    const stdout: string[] = [];
    const code = await runCli(["plugin", "add", "./p"], {
      cwd: () => "/cwd",
      homedir: () => "/home",
      createRuntime,
      installPluginFromPath,
      stdout: { write: (c) => stdout.push(c) },
      stderr: { write: () => {} },
    });
    expect(code).toBe(0);
    expect(stdout.join("")).toBe("added sample\n");
    expect(createRuntime).not.toHaveBeenCalled();
    expect(installPluginFromPath).toHaveBeenCalledWith({
      workspaceRoot: "/cwd",
      homeDir: "/home",
      sourcePath: "./p",
    });
  });

  it("writes err.message to stderr when plugin add fails", async () => {
    const stderr: string[] = [];
    const code = await runCli(["plugin", "add", "./p"], {
      cwd: () => "/cwd",
      homedir: () => "/home",
      createRuntime: vi.fn(),
      installPluginFromPath: vi.fn(async () => {
        throw new Error("path");
      }),
      stdout: { write: () => {} },
      stderr: { write: (c) => stderr.push(c) },
    });
    expect(code).toBe(1);
    expect(stderr.join("")).toBe("path\n");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run apps/cli/tests/cli.test.ts`

Expected: FAIL（`parseCliArgv` / `runCli` 不存在）。

- [ ] **Step 3: Implement argv, runCli, bin, and the kernel dependency**

创建 `apps/cli/src/argv.ts`：

```ts
export type CliTurnCommand = {
  kind: "turn";
  workspace: string;
  text: string;
};

export type CliPluginAddCommand = {
  kind: "plugin-add";
  workspace: string;
  sourcePath: string;
  id?: string;
};

export type CliCommand = CliTurnCommand | CliPluginAddCommand;

export function parseCliArgv(argv: string[], cwd: string): CliCommand {
  let workspace = cwd;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--workspace") {
      const next = argv[i + 1];
      if (next !== undefined) {
        workspace = next;
        i += 1;
      }
      continue;
    }
    rest.push(arg);
  }

  if (rest[0] === "plugin") {
    if (rest[1] !== "add") {
      throw new Error("plugin add");
    }
    let id: string | undefined;
    let sourcePath: string | undefined;
    for (let i = 2; i < rest.length; i++) {
      const arg = rest[i]!;
      if (arg === "--id") {
        const next = rest[i + 1];
        if (next === undefined) {
          throw new Error("id");
        }
        if (id !== undefined) {
          throw new Error("id");
        }
        id = next;
        i += 1;
        continue;
      }
      if (sourcePath !== undefined) {
        throw new Error("path");
      }
      sourcePath = arg;
    }
    if (sourcePath === undefined) {
      throw new Error("path");
    }
    const command: CliPluginAddCommand = {
      kind: "plugin-add",
      workspace,
      sourcePath,
    };
    if (id !== undefined) {
      command.id = id;
    }
    return command;
  }

  return { kind: "turn", workspace, text: rest.join(" ") };
}
```

创建 `apps/cli/src/run.ts`：

```ts
import type { createRuntime } from "@flintloom/host";
import {
  installPluginFromPath,
  type InstallPluginFromPathInput,
} from "@flintloom/kernel";
import type { LoopService } from "@flintloom/loop";
import type { SessionStore } from "@flintloom/session";
import { parseCliArgv } from "./argv.ts";
import { formatCliOutput } from "./output.ts";

export type CliDeps = {
  cwd: () => string;
  homedir: () => string;
  createRuntime: typeof createRuntime;
  installPluginFromPath: (
    input: InstallPluginFromPathInput,
  ) => ReturnType<typeof installPluginFromPath>;
  stdout: { write: (chunk: string) => void };
  stderr: { write: (chunk: string) => void };
};

export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  let command;
  try {
    command = parseCliArgv(argv, deps.cwd());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.stderr.write(message + "\n");
    return 1;
  }

  if (command.kind === "plugin-add") {
    try {
      const input: InstallPluginFromPathInput = {
        workspaceRoot: command.workspace,
        homeDir: deps.homedir(),
        sourcePath: command.sourcePath,
      };
      if (command.id !== undefined) {
        input.id = command.id;
      }
      const { id } = await deps.installPluginFromPath(input);
      deps.stdout.write("added " + id + "\n");
      return 0;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deps.stderr.write(message + "\n");
      return 1;
    }
  }

  const { ctx, stop } = await deps.createRuntime(
    command.workspace,
    deps.homedir(),
  );
  const session = ctx.require<SessionStore>("sessions").getOrCreate("cli");
  const { status } = await ctx.require<LoopService>("loop").runTurn({
    ctx,
    session,
    text: command.text,
    workspaceRoot: command.workspace,
    channel: "cli",
    signal: new AbortController().signal,
  });
  const output = formatCliOutput(session.events(), status);
  stop();
  if (output.stdout !== "") {
    deps.stdout.write(output.stdout);
  }
  if (output.stderr !== "") {
    deps.stderr.write(output.stderr);
  }
  return status === "ok" ? 0 : 1;
}
```

`stop()` 必须在 `formatCliOutput` **之后**（先投影 session，再 dispose）。不要用会在投影前 `stop()` 的 `try/finally`。

`apps/cli/src/bin.ts` 整文件替换为：

```ts
import { homedir } from "node:os";
import { createRuntime } from "@flintloom/host";
import { installPluginFromPath } from "@flintloom/kernel";
import { runCli } from "./run.ts";

const code = await runCli(process.argv.slice(2), {
  cwd: () => process.cwd(),
  homedir,
  createRuntime,
  installPluginFromPath,
  stdout: process.stdout,
  stderr: process.stderr,
});
process.exit(code);
```

`apps/cli/package.json` 的 `dependencies` 增加：

```json
"@flintloom/kernel": "workspace:*"
```

然后在仓库根运行 `pnpm install`（更新 lockfile）。不要手改 lockfile。

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run apps/cli/tests/cli.test.ts packages/kernel`

Expected: PASS。

然后：

Run: `pnpm test`

Expected: PASS（全仓现有测试仍绿）。

Run: `pnpm typecheck`

Expected: 无错误。

- [ ] **Step 5: Commit**

```powershell
git add apps/cli/src/argv.ts apps/cli/src/run.ts apps/cli/src/bin.ts apps/cli/package.json apps/cli/tests/cli.test.ts pnpm-lock.yaml
git commit -m @"
feat: add flint plugin add CLI subcommand
"@
```

不要 `git add` `scripts/desktop-dev.ts` 或 `check_libs.py`。
