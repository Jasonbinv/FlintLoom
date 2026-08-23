export async function pickWorkspaceFolder(): Promise<string | undefined> {
  if (window.flintloom?.pickWorkspaceFolder) {
    return window.flintloom.pickWorkspaceFolder();
  }
  const path = window.prompt("输入工作区目录的绝对路径（需包含 flintloom.yml）：");
  const trimmed = path?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export function formatWorkspaceLabel(workspaceRoot: string): string {
  const parts = workspaceRoot.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length <= 2) return workspaceRoot;
  return `…/${parts.slice(-2).join("/")}`;
}
