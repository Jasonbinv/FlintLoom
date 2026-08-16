import type { Context, FlintPlugin } from "@flintloom/kernel";
import type { ToolRegistry } from "@flintloom/tools";
import { createDocParseTool, createDocProbeTool } from "./tools.ts";

export type { DocType, ProbeResult } from "./types.ts";
export { detectType } from "./detect.ts";
export { probe } from "./probe.ts";
export { parse } from "./parse.ts";
export { truncateOutput } from "./truncate.ts";
export { createDocProbeTool, createDocParseTool };

const plugin: FlintPlugin = {
  name: "@flintloom/docforge",
  apply(ctx: Context) {
    const tools = ctx.require<ToolRegistry>("tools");
    ctx.effect(tools.register(createDocProbeTool()));
    ctx.effect(tools.register(createDocParseTool()));
  },
};

export default plugin;
