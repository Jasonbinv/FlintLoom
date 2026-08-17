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

export {
  INFOGRAPHIC_MAX_BYTES,
  applyOps,
  parseDocument,
  type InfographicDocument,
  type InfographicEdge,
  type InfographicNode,
  type InfographicOp,
} from "./document.ts";
export { isInfographicRelPath } from "./path.ts";
export { renderSvg } from "./render.ts";
export { createInfographicGetTool, createInfographicPatchTool } from "./tool.ts";
export default plugin;
