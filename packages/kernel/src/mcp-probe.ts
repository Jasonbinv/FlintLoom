import type { ImportFn } from "./apply-config.ts";
import { defaultImport } from "./plugin-entry.ts";
import { WORKSPACE_ROOT_OVERLAY_PACKAGES } from "./plugin-overlay.ts";
import { listMcpServerDeclarations } from "./mcp-servers-write.ts";
import { resolveMcpEnvValues } from "./mcp-servers.ts";

export type McpProbeResult =
  | { ok: true; tools: string[] }
  | { ok: false; error: string };

type PackageProbe = (
  config: Record<string, unknown>,
  timeoutMs?: number,
) => Promise<McpProbeResult>;

function readPackageProbe(mod: unknown): PackageProbe {
  if (mod !== null && typeof mod === "object") {
    const fn = (mod as { probeMcpServer?: unknown }).probeMcpServer;
    if (typeof fn === "function") return fn as PackageProbe;
  }
  throw new Error("mcp");
}

export async function probeMcpServer(input: {
  workspaceRoot: string;
  homeDir: string;
  id: string;
  command?: string;
  args?: string[];
  env?: string[];
  fileEnv: Record<string, string>;
  importFn?: ImportFn;
}): Promise<McpProbeResult> {
  const listed = listMcpServerDeclarations({
    workspaceRoot: input.workspaceRoot,
    homeDir: input.homeDir,
  });
  const found = listed.find((row) => row.id === input.id);
  if (found === undefined) {
    throw new Error("id");
  }
  if (found.enabled === false) {
    throw new Error("enabled");
  }

  const draftCommand = input.command;
  const useDraft = draftCommand !== undefined;
  if (useDraft && draftCommand.length === 0) {
    throw new Error("command");
  }

  const command = useDraft ? draftCommand : found.command;
  const args = useDraft ? (input.args ?? []) : (found.args ?? []);
  const env = useDraft ? (input.env ?? []) : (found.env ?? []);

  const config: Record<string, unknown> = {
    id: found.id,
    command,
    args,
    env,
    workspaceRoot: input.workspaceRoot,
  };
  const envValues = resolveMcpEnvValues(env, input.fileEnv);
  if (envValues !== undefined) {
    config.envValues = envValues;
  }

  const importFn = input.importFn ?? defaultImport;
  try {
    const mod = await importFn(WORKSPACE_ROOT_OVERLAY_PACKAGES[0]);
    const probe = readPackageProbe(mod);
    return await probe(config);
  } catch (err) {
    const message = err instanceof Error ? err.message : "mcp";
    if (message === "id" || message === "command" || message === "args" || message === "env") {
      throw err instanceof Error ? err : new Error(message);
    }
    return { ok: false, error: "mcp" };
  }
}
