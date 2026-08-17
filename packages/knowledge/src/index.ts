import { homedir } from "node:os";
import { join } from "node:path";
import type { Context, FlintPlugin } from "@flintloom/kernel";
import type { ToolRegistry } from "@flintloom/tools";
import { openKnowledge } from "./store.ts";
import { createKnowledgeSearchTool } from "./tool.ts";

function dbPathFromConfig(config: Record<string, unknown>): string {
  return typeof config.dbPath === "string" && config.dbPath.length > 0
    ? config.dbPath
    : join(homedir(), ".flintloom", "knowledge.sqlite");
}

const plugin: FlintPlugin = {
  name: "@flintloom/knowledge",
  apply(ctx: Context, config: Record<string, unknown>) {
    const tools = ctx.require<ToolRegistry>("tools");
    const kb = openKnowledge(dbPathFromConfig(config));
    ctx.provide("knowledge", kb);
    ctx.effect(() => {
      kb.close();
    });
    ctx.effect(tools.register(createKnowledgeSearchTool(kb)));
  },
};

export type {
  KnowledgeHit,
  KnowledgeIngestInput,
  KnowledgeRecord,
  KnowledgeService,
  KnowledgeStatus,
} from "./types.ts";
export { openKnowledge } from "./store.ts";
export { createKnowledgeSearchTool } from "./tool.ts";
export default plugin;
