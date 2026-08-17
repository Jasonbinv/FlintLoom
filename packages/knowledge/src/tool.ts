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

export function createKnowledgeSearchTool(kb: KnowledgeService): ToolDefinition {
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
      const hits = kb.search(trimmed).map(({ workspaceRoot: _workspaceRoot, ...rest }) => rest);
      return JSON.stringify({ q: trimmed, hits });
    },
  };
}
