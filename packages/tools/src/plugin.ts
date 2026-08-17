import type { Context, FlintPlugin } from "@flintloom/kernel";
import type { ModelRegistry } from "@flintloom/models";
import { ToolRegistry } from "./registry.ts";
import { TOOLS_PRE_EXECUTE, type ToolPreExecutePayload } from "./types.ts";

const plugin: FlintPlugin = {
  name: "@flintloom/tools",
  apply(ctx: Context) {
    const registry = new ToolRegistry(ctx);
    ctx.provide("tools", registry);
    ctx.hook(TOOLS_PRE_EXECUTE, async (payload, next) => {
      const p = payload as ToolPreExecutePayload;
      const models = ctx.require<ModelRegistry>("models");
      const guard = models.resolveGuard();
      if (guard === undefined) {
        return next();
      }
      const decision = await guard.gate(
        {
          tool: p.tool,
          args: p.args,
          workspaceRoot: p.workspaceRoot,
          channel: p.channel,
        },
        p.signal,
      );
      if (decision === "deny") {
        return `guard denied: ${p.tool}`;
      }
      if (decision === "ask") {
        return `guard denied: ${p.tool} (ask not supported in slice 1)`;
      }
      return next();
    });
  },
};

export default plugin;
