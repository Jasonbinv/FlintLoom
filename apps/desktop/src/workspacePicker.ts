import { pickWorkspaceFromHost } from "./api.ts";

export type WorkspacePathDialogOptions = {
  initialPath?: string;
};

type WorkspacePathDialogHandler = (
  opts: WorkspacePathDialogOptions,
) => Promise<string | undefined>;

let dialogHandler: WorkspacePathDialogHandler | undefined;

export function registerWorkspacePathDialog(
  handler: WorkspacePathDialogHandler,
): () => void {
  dialogHandler = handler;
  return () => {
    if (dialogHandler === handler) {
      dialogHandler = undefined;
    }
  };
}

export function hasNativeWorkspacePicker(): boolean {
  return window.flintloom?.pickWorkspaceFolder !== undefined;
}

/** Trim quotes and whitespace from a manually entered Windows/Unix path. */
export function normalizeWorkspaceInput(raw: string): string | undefined {
  let trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Electron bridge or Host native folder dialog. */
export async function browseWorkspaceFolder(
  initialPath?: string,
): Promise<string | undefined> {
  if (hasNativeWorkspacePicker()) {
    return window.flintloom!.pickWorkspaceFolder();
  }
  const result = await pickWorkspaceFromHost(initialPath);
  if (result.status === "picked") {
    return result.path;
  }
  return undefined;
}

export async function pickWorkspaceFolder(
  initialPath?: string,
): Promise<string | undefined> {
  if (hasNativeWorkspacePicker()) {
    return window.flintloom!.pickWorkspaceFolder();
  }
  const hostPick = await pickWorkspaceFromHost(initialPath);
  if (hostPick.status === "picked") {
    return hostPick.path;
  }
  if (hostPick.status === "canceled") {
    return undefined;
  }
  if (dialogHandler === undefined) {
    return undefined;
  }
  return dialogHandler({ initialPath });
}

export function formatWorkspaceLabel(workspaceRoot: string): string {
  const parts = workspaceRoot.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length <= 2) return workspaceRoot;
  return `…/${parts.slice(-2).join("/")}`;
}
