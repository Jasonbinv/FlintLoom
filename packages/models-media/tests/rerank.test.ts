import { describe, expect, it } from "vitest";
import { createDashscopeRerank } from "../src/rerank.ts";

describe("createDashscopeRerank", () => {
  it("maps relevance_score by document index", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          output: {
            results: [
              { index: 1, relevance_score: 0.9 },
              { index: 0, relevance_score: 0.2 },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    const rerank = createDashscopeRerank({
      origin: "https://dashscope.aliyuncs.com",
      apiKey: "sk-test",
      model: "gte-rerank-v2",
      fetchImpl,
    });
    const scores = await rerank.rerank(
      { query: "cats", documents: ["birds", "cats and dogs"] },
      new AbortController().signal,
    );
    expect(scores).toEqual([0.2, 0.9]);
  });
});
