import type { Context, FlintPlugin } from "@flintloom/kernel";
import type { ToolRegistry } from "@flintloom/tools";
import { infographicChatSurface } from "./compile.ts";
import { applyOps, parseDocument } from "./document.ts";
import { renderSvg } from "./render.ts";
import {
  createInfographicGetTool,
  createInfographicPatchTool,
  createInfographicRenderTool,
} from "./tool.ts";

const plugin: FlintPlugin = {
  name: "@flintloom/infographic",
  apply(ctx: Context) {
    const tools = ctx.require<ToolRegistry>("tools");
    ctx.provide("infographic", {
      parseDocument,
      applyOps,
      renderSvg,
      chatSurface: infographicChatSurface,
    });
    ctx.effect(tools.register(createInfographicGetTool()));
    ctx.effect(tools.register(createInfographicPatchTool()));
    ctx.effect(tools.register(createInfographicRenderTool()));
  },
};

export default plugin;
