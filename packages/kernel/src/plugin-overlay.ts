/** Package names that receive `workspaceRoot` from host overlay at boot. */
export const WORKSPACE_ROOT_OVERLAY_PACKAGES = ["@flintloom/mcp"] as const;

export function needsWorkspaceRootOverlay(packageName: string): boolean {
  return (WORKSPACE_ROOT_OVERLAY_PACKAGES as readonly string[]).includes(
    packageName,
  );
}
