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
