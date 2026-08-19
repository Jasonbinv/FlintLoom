import type { Context, FlintPlugin } from "@flintloom/kernel";
import type { KnowledgeService } from "@flintloom/knowledge";
import type { ModelRegistry } from "@flintloom/models";
import type { ToolRegistry } from "@flintloom/tools";
import {
  createDocCompareTool,
  createDocConvertTool,
  createDocEditTool,
  createDocGenerateTool,
  createDocIngestTool,
  createDocParseTool,
  createDocProbeTool,
  createDocSummarizeTool,
} from "./tools.ts";

export type { DocType, ProbeResult } from "./types.ts";
export { detectType } from "./detect.ts";
export { probe } from "./probe.ts";
export type { ParseMarkdownResult } from "./parse.ts";
export { parse, parseToMarkdown } from "./parse.ts";
export { compareDocuments } from "./compare.ts";
export type { SummarizeResult } from "./summarize.ts";
export {
  SUMMARIZE_MAX_CHARS,
  SUMMARIZE_SYSTEM,
  summarizeDocument,
} from "./summarize.ts";
export { truncateOutput } from "./truncate.ts";
export { ingestWorkspaceFile } from "./ingest.ts";
export type { IngestOutcome } from "./ingest.ts";
export type { Block, GenerateFormat } from "./generate.ts";
export {
  GENERATE_MAX_BYTES,
  GENERATE_MAX_CHARS,
  buildDocument,
  defaultFontPath,
  formatFromOutRelPath,
  generateDocument,
  parseBlocks,
} from "./generate.ts";
export type { ConvertFrom } from "./convert.ts";
export { convertDocument, lossForConvert } from "./convert.ts";
export { countNonOverlap, editMarkdown, normalizeMarkdown } from "./edit.ts";
export {
  createDocProbeTool,
  createDocParseTool,
  createDocConvertTool,
  createDocGenerateTool,
  createDocEditTool,
  createDocCompareTool,
  createDocSummarizeTool,
  createDocIngestTool,
};

const plugin: FlintPlugin = {
  name: "@flintloom/docforge",
  apply(ctx: Context) {
    const tools = ctx.require<ToolRegistry>("tools");
    const models = ctx.require<ModelRegistry>("models");
    const kb = ctx.require<KnowledgeService>("knowledge");
    ctx.effect(tools.register(createDocProbeTool()));
    ctx.effect(tools.register(createDocParseTool()));
    ctx.effect(tools.register(createDocConvertTool()));
    ctx.effect(tools.register(createDocGenerateTool()));
    ctx.effect(tools.register(createDocEditTool()));
    ctx.effect(tools.register(createDocCompareTool()));
    ctx.effect(tools.register(createDocSummarizeTool(models)));
    ctx.effect(tools.register(createDocIngestTool(kb)));
  },
};

export default plugin;
