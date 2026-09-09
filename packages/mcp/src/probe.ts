import { McpStdioClient } from "./client.ts";
import { validateMcpConfig } from "./config.ts";
import { buildChildEnv } from "./env.ts";
import { publicMcpError } from "./errors.ts";
import { registeredMcpToolNames } from "./tools.ts";

export const MCP_PROBE_TIMEOUT_MS = 30_000;

export type McpProbeResult =
  | { ok: true; tools: string[] }
  | { ok: false; error: string };

export async function probeMcpServer(
  config: Record<string, unknown>,
  timeoutMs: number = MCP_PROBE_TIMEOUT_MS,
): Promise<McpProbeResult> {
  let client: McpStdioClient | undefined;
  try {
    const cfg = validateMcpConfig(config);
    const childEnv = buildChildEnv({
      declared: cfg.env,
      envValues: cfg.envValues,
    });
    client = new McpStdioClient({
      command: cfg.command,
      args: cfg.args,
      cwd: cfg.workspaceRoot,
      env: childEnv,
    });
    await client.initialize(timeoutMs);
    return {
      ok: true,
      tools: registeredMcpToolNames(cfg.id, client.listTools()),
    };
  } catch (err) {
    return { ok: false, error: publicMcpError(err) };
  } finally {
    client?.kill();
  }
}
