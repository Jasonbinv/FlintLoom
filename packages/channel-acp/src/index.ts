import type { FlintPlugin } from "@flintloom/kernel";

const plugin: FlintPlugin = {
  name: "@flintloom/channel-acp",
  apply() {
    // ACP stdio is started by `flint acp`, not from plugin apply.
  },
};

export { handleAcpRequest, runAcpStdio } from "./stdio.ts";
export { acpToolKind, emitAcpSessionEvent } from "./updates.ts";
export default plugin;
