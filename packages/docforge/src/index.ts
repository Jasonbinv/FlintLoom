import type { Context, FlintPlugin } from "@flintloom/kernel";
import type { KnowledgeService } from "@flintloom/knowledge";
import type { ToolRegistry } from "@flintloom/tools";
import {
  createDocIngestTool,
  createDocParseTool,
  createDocProbeTool,
} from "./tools.ts";

export type { DocType, ProbeResult } from "./types.ts";
export { detectType } from "./detect.ts";
export { probe } from "./probe.ts";
export { parse } from "./parse.ts";
export { truncateOutput } from "./truncate.ts";
export { ingestWorkspaceFile } from "./ingest.ts";
export type { IngestOutcome } from "./ingest.ts";
export type { Block, GenerateFormat } from "./generate.ts";
export {
  GENERATE_MAX_BYTES,
  GENERATE_MAX_CHARS,
  buildDocument,
  formatFromOutRelPath,
  parseBlocks,
} from "./generate.ts";
export { createDocProbeTool, createDocParseTool, createDocIngestTool };

const plugin: FlintPlugin = {
  name: "@flintloom/docforge",
  apply(ctx: Context) {
    const tools = ctx.require<ToolRegistry>("tools");
    const kb = ctx.require<KnowledgeService>("knowledge");
    ctx.effect(tools.register(createDocProbeTool()));
    ctx.effect(tools.register(createDocParseTool()));
    ctx.effect(tools.register(createDocIngestTool(kb)));
  },
};

export default plugin;
