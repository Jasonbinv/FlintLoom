import {
  applyCredentialPatch,
  buildCredentialsSnapshot,
  resolveWorkspaceRoot,
  type CredentialSlotId,
} from "@flintloom/host";

const DEFAULT_HOST_PORT = 7331;

export function runConfigGet(opts: {
  homeDir: string;
  workspace: string;
  slotId?: CredentialSlotId;
}): string {
  const workspaceRoot = resolveWorkspaceRoot(opts.homeDir, opts.workspace);
  const snapshot = buildCredentialsSnapshot(
    opts.homeDir,
    workspaceRoot,
    DEFAULT_HOST_PORT,
  );
  if (opts.slotId === undefined) {
    const lines = snapshot.slots.map(
      (slot) => `${slot.id}\t${slot.configured ? "configured" : "not configured"}\t${slot.source}`,
    );
    return `${lines.join("\n")}\n`;
  }
  const slot = snapshot.slots.find((row) => row.id === opts.slotId);
  if (slot === undefined) {
    throw new Error("slot");
  }
  return `${JSON.stringify(slot, null, 2)}\n`;
}

export function runConfigSet(opts: {
  homeDir: string;
  slotId: CredentialSlotId;
  field: string;
  value: string;
}): void {
  applyCredentialPatch(opts.homeDir, opts.slotId, {
    [opts.field]: opts.value,
  });
}
