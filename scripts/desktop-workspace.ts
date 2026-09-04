import { homedir } from "node:os";
import { resolveWorkspaceRoot, validateWorkspaceRoot } from "@flintloom/host";

/** Resolve workspace for desktop scripts; honors FLINT_WORKSPACE_ROOT when valid. */
export function resolveDesktopWorkspace(cwd = process.cwd()): string {
  const override = process.env.FLINT_WORKSPACE_ROOT?.trim();
  if (override && validateWorkspaceRoot(override)) {
    return override;
  }
  return resolveWorkspaceRoot(homedir(), cwd);
}

export function logDesktopWorkspace(workspaceRoot: string): void {
  console.log(`[desktop] workspace: ${workspaceRoot}`);
}
