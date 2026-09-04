import type { ToolDefinition, ToolExec } from "@flintloom/tools";
import { formatSearchHits } from "./format.ts";
import { searchWeb } from "./search.ts";
import type { SearchConfig } from "./types.ts";

function normalizeCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 8) {
    return 5;
  }
  return value;
}

export function createWebSearchTool(config: SearchConfig): ToolDefinition {
  return {
    name: "web_search",
    description:
      "Search the public web. Use for current events, docs, or facts not in the workspace.",
    parameters: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string", minLength: 1, maxLength: 200 },
        count: { type: "integer", minimum: 1, maximum: 8 },
      },
    },
    async execute(args, exec: ToolExec) {
      if (exec.webSearch !== true) {
        return "failed: web_search disabled";
      }

      if (typeof args.query !== "string") {
        return "failed: empty query";
      }

      const query = args.query.trim();
      if (query.length === 0) {
        return "failed: empty query";
      }

      const trimmedQuery = query.length > 200 ? query.slice(0, 200) : query;
      const count = normalizeCount(args.count);

      const outcome = await searchWeb(config, { query: trimmedQuery, count }, exec.signal);
      if (!outcome.ok) {
        return outcome.error;
      }

      return formatSearchHits(outcome.hits);
    },
  };
}
