import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export function workspacePrefsPath(homeDir: string): string {
  return join(homeDir, ".flintloom", "workspace");
}

export function validateWorkspaceRoot(workspaceRoot: string): boolean {
  try {
    const real = realpathSync.native(workspaceRoot);
    return existsSync(join(real, "flintloom.yml"));
  } catch {
    return false;
  }
}

export function normalizeWorkspaceRoot(workspaceRoot: string): string {
  return realpathSync.native(workspaceRoot);
}

export function readPersistedWorkspace(homeDir: string): string | undefined {
  try {
    const text = readFileSync(workspacePrefsPath(homeDir), "utf8").trim();
    if (text.length === 0) return undefined;
    const real = normalizeWorkspaceRoot(text);
    if (!validateWorkspaceRoot(real)) return undefined;
    return real;
  } catch {
    return undefined;
  }
}

export function writePersistedWorkspace(
  homeDir: string,
  workspaceRoot: string,
): void {
  mkdirSync(join(homeDir, ".flintloom"), { recursive: true });
  writeFileSync(
    workspacePrefsPath(homeDir),
    `${normalizeWorkspaceRoot(workspaceRoot)}\n`,
    "utf8",
  );
}

export function resolveWorkspaceRoot(
  homeDir: string,
  fallback: string,
): string {
  const persisted = readPersistedWorkspace(homeDir);
  if (persisted) return persisted;
  try {
    const real = normalizeWorkspaceRoot(fallback);
    if (validateWorkspaceRoot(real)) return real;
  } catch {
    // invalid fallback cwd
  }
  return fallback;
}
