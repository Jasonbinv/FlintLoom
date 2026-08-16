import { realpathSync } from "node:fs";
import path from "node:path";

export class WorkspaceEscapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceEscapeError";
  }
}

function normalizeForComparison(filePath: string): string {
  const normalized = path.normalize(filePath);
  if (process.platform === "win32") {
    return normalized.replaceAll("/", "\\").toLowerCase();
  }
  return normalized;
}

function isInsideWorkspace(workspaceRealpath: string, targetPath: string): boolean {
  const workspaceNorm = normalizeForComparison(workspaceRealpath);
  const targetNorm = normalizeForComparison(targetPath);

  if (targetNorm === workspaceNorm) {
    return true;
  }

  const separator =
    process.platform === "win32" ? `${workspaceNorm}\\` : `${workspaceNorm}${path.sep}`;
  return targetNorm.startsWith(separator);
}

export function resolveInside(workspaceRoot: string, inputPath: string): string {
  const resolved = path.resolve(workspaceRoot, inputPath);
  const workspaceRealpath = realpathSync.native(workspaceRoot);

  let targetRealpath: string;
  try {
    targetRealpath = realpathSync.native(resolved);
  } catch {
    const parent = path.dirname(resolved);
    const leaf = path.basename(resolved);
    const parentRealpath = realpathSync.native(parent);
    targetRealpath = path.join(parentRealpath, leaf);
  }

  if (!isInsideWorkspace(workspaceRealpath, targetRealpath)) {
    throw new WorkspaceEscapeError(
      `Path escapes workspace: ${inputPath}`,
    );
  }

  return targetRealpath;
}
