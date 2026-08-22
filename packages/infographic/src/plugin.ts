import type { Context, FlintPlugin } from "@flintloom/kernel";
import type { ToolRegistry } from "@flintloom/tools";
import { applyOps, parseDocument } from "./document.ts";
import { renderSvg } from "./render.ts";
import { createInfographicGetTool, createInfographicPatchTool } from "./tool.ts";

const plugin: FlintPlugin = {
  name: "@flintloom/infographic",
  apply(ctx: Context) {
    const tools = ctx.require<ToolRegistry>("tools");
    ctx.provide("infographic", { parseDocument, applyOps, renderSvg });
    ctx.effect(tools.register(createInfographicGetTool()));
    ctx.effect(tools.register(createInfographicPatchTool()));
  },
};

export default plugin;
