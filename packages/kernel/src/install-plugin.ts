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
  } catch (err) {
    rmIfExists(tmp);
    throw err;
  }
  try {
    rmIfExists(bak);
  } catch {
    // best-effort after yml replace succeeded
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
