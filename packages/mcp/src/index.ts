import {
  MCP_SERVER_STATUS_KEY,
  type Context,
  type FlintPlugin,
  type McpServerRuntimeStatus,
} from "@flintloom/kernel";
import type { ToolRegistry } from "@flintloom/tools";
import { McpStdioClient } from "./client.ts";
import { validateMcpConfig } from "./config.ts";
import { buildChildEnv } from "./env.ts";
import { publicMcpError } from "./errors.ts";
import { registerMcpTools } from "./tools.ts";

function statusTable(ctx: Context): Map<string, McpServerRuntimeStatus> {
  let table = ctx.get<Map<string, McpServerRuntimeStatus>>(MCP_SERVER_STATUS_KEY);
  if (table === undefined) {
    table = new Map();
    ctx.provide(MCP_SERVER_STATUS_KEY, table);
  }
  return table;
}

const plugin: FlintPlugin = {
  name: "@flintloom/mcp",
  async apply(ctx: Context, config: Record<string, unknown>) {
    const table = statusTable(ctx);
    const id = typeof config.id === "string" ? config.id : "invalid";
    let client: McpStdioClient | undefined;
    try {
      const tools = ctx.require<ToolRegistry>("tools");
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
      await client.initialize();
      const unregister = registerMcpTools({
        tools,
        id: cfg.id,
        client,
      });
      ctx.effect(() => {
        unregister();
        client?.kill();
      });
      const prefix = `mcp__${cfg.id}__`;
      table.set(cfg.id, {
        status: "loaded",
        tools: tools
          .schemas()
          .map((schema) => schema.name)
          .filter((name) => name.startsWith(prefix)),
      });
    } catch (err) {
      client?.kill();
      table.set(id, {
        status: "error",
        error: publicMcpError(err),
        tools: [],
      });
    }
  },
};

export { McpStdioClient } from "./client.ts";
export { validateMcpConfig } from "./config.ts";
export { buildChildEnv } from "./env.ts";
export { registerMcpTools } from "./tools.ts";
export { probeMcpServer, MCP_PROBE_TIMEOUT_MS, type McpProbeResult } from "./probe.ts";
export default plugin;
