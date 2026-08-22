import { ModelKindMissingError, type ModelRegistry } from "@flintloom/models";
import type { ToolDefinition } from "@flintloom/tools";
import type { KnowledgeService } from "./types.ts";

function qArg(args: Record<string, unknown>): string | undefined {
  if (typeof args.q !== "string") {
    return undefined;
  }
  const trimmed = args.q.trim();
  if (trimmed.length === 0 || trimmed.length > 200) {
    return undefined;
  }
  return trimmed;
}

export function createKnowledgeSearchTool(
  kb: KnowledgeService,
  models: ModelRegistry,
): ToolDefinition {
  return {
    name: "knowledge_search",
    description: "Search the local knowledge base by query text.",
    parameters: {
      type: "object",
      properties: { q: { type: "string" } },
      required: ["q"],
    },
    async execute(args, exec) {
      if (exec.signal.aborted) {
        return "aborted";
      }
      const trimmed = qArg(args);
      if (trimmed === undefined) {
        return "failed: missing q";
      }
      const hits = (
        await kb.search(trimmed, {
          signal: exec.signal,
          embedQuery: async (text, signal) => {
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
          rerank: async (query, documents, signal) => {
            try {
              const rerank = models.resolveRerank();
              return await rerank.rerank({ query, documents }, signal);
            } catch (err) {
              if (err instanceof ModelKindMissingError) {
                return undefined;
              }
              throw err;
            }
          },
        })
      ).map(({ workspaceRoot: _workspaceRoot, ...rest }) => rest);
      return JSON.stringify({ q: trimmed, hits });
    },
  };
}
