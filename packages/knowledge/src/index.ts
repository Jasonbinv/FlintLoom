import { homedir } from "node:os";
import { join } from "node:path";
import type { Context, FlintPlugin } from "@flintloom/kernel";
import { ModelKindMissingError, type ModelRegistry } from "@flintloom/models";
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
    const models = ctx.get<ModelRegistry>("models");
    const kb = openKnowledge(dbPathFromConfig(config), {
      embedText:
        models === undefined
          ? undefined
          : async (text, signal) => {
              try {
                const embedding = models.resolveEmbedding();
                const vectors = await embedding.embed({ texts: [text] }, signal);
                return vectors[0];
              } catch (err) {
                if (err instanceof ModelKindMissingError) {
                  return undefined;
                }
                throw err;
              }
            },
    });
    ctx.provide("knowledge", kb);
    ctx.effect(() => {
      kb.close();
    });
    if (models !== undefined) {
      ctx.effect(tools.register(createKnowledgeSearchTool(kb, models)));
    }
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
