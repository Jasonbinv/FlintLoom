import type { Context, FlintPlugin } from "@flintloom/kernel";
import type { ToolRegistry } from "@flintloom/tools";
import { createGetWeatherTool } from "./tool.ts";

const plugin: FlintPlugin = {
  name: "@flintloom/weather",
  apply(ctx: Context) {
    const tools = ctx.require<ToolRegistry>("tools");
    ctx.effect(tools.register(createGetWeatherTool()));
  },
};

export { createGetWeatherTool } from "./tool.ts";
export default plugin;
