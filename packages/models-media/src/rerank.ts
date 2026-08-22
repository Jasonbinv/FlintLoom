import type { RerankInput, RerankProvider } from "@flintloom/models";
import type { DashscopeMediaOptions } from "./dashscope.ts";
import { dashscopeJson } from "./dashscope.ts";

export function createDashscopeRerank(
  opts: DashscopeMediaOptions & { model: string },
): RerankProvider {
  return {
    async rerank(input: RerankInput, signal: AbortSignal): Promise<number[]> {
      const json = await dashscopeJson(
        opts,
        "/api/v1/services/rerank/text-rerank/text-rerank",
        {
          model: opts.model,
          input: {
            query: input.query,
            documents: input.documents,
          },
        },
        signal,
      );
      const output = json.output;
      if (output === null || typeof output !== "object") {
        throw new Error("no output");
      }
      const results = (output as { results?: unknown }).results;
      if (!Array.isArray(results)) {
        throw new Error("no results");
      }
      const scores = new Array<number>(input.documents.length).fill(0);
      for (const item of results) {
        if (item === null || typeof item !== "object") {
          continue;
        }
        const index = (item as { index?: unknown }).index;
        const score = (item as { relevance_score?: unknown }).relevance_score;
        if (
          typeof index === "number" &&
          index >= 0 &&
          index < scores.length &&
          typeof score === "number"
        ) {
          scores[index] = score;
        }
      }
      return scores;
    },
  };
}
