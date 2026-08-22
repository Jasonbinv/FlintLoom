import type { Context, FlintPlugin } from "@flintloom/kernel";
import type { ToolRegistry } from "@flintloom/tools";
import { McpStdioClient } from "./client.ts";
import { validateMcpConfig } from "./config.ts";
import { buildChildEnv } from "./env.ts";
import { registerMcpTools } from "./tools.ts";

const plugin: FlintPlugin = {
  name: "@flintloom/mcp",
  async apply(ctx: Context, config: Record<string, unknown>) {
    const tools = ctx.require<ToolRegistry>("tools");
    const cfg = validateMcpConfig(config);
    const childEnv = buildChildEnv({
      declared: cfg.env,
      envValues: cfg.envValues,
    });
    const client = new McpStdioClient({
      command: cfg.command,
      args: cfg.args,
      cwd: cfg.workspaceRoot,
      env: childEnv,
    });
    try {
      await client.initialize();
    } catch (err) {
      client.kill();
      throw err;
    }
    const unregister = registerMcpTools({
      tools,
      id: cfg.id,
      client,
    });
    ctx.effect(() => {
      unregister();
      client.kill();
    });
  },
};

export { McpStdioClient } from "./client.ts";
export { validateMcpConfig } from "./config.ts";
export { buildChildEnv } from "./env.ts";
export { registerMcpTools } from "./tools.ts";
export default plugin;
