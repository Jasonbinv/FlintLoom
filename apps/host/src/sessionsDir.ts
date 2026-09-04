import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { join } from "node:path";

export function workspaceSessionsDir(homeDir: string, workspaceRoot: string): string {
  let normalized = workspaceRoot;
  try {
    normalized = realpathSync.native(workspaceRoot);
  } catch {
    // keep provided root when the path is not yet resolvable
  }
  const key = createHash("sha256").update(normalized).digest("base64url");
  return join(homeDir, ".flintloom", "sessions", key);
}
