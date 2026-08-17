import type { Context, FlintPlugin } from "@flintloom/kernel";
import type { ToolRegistry } from "@flintloom/tools";
import { createA2uiEmitTool } from "./tool.ts";
import { createA2uiService } from "./validate.ts";

const plugin: FlintPlugin = {
  name: "@flintloom/a2ui",
  apply(ctx: Context) {
    const tools = ctx.require<ToolRegistry>("tools");
    const svc = createA2uiService();
    ctx.provide("a2ui", svc);
    ctx.effect(tools.register(createA2uiEmitTool(svc)));
  },
};

export type {
  A2uiAction,
  A2uiComponent,
  A2uiEmitSnapshot,
  A2uiMessage,
  A2uiService,
} from "./types.ts";
export { A2UI_CATALOG_ID } from "./types.ts";
export { createA2uiService } from "./validate.ts";
export { createA2uiEmitTool } from "./tool.ts";
export default plugin;
