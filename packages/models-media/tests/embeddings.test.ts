import { describe, expect, it } from "vitest";
import { createOpenAiCompatEmbedding } from "../src/embeddings.ts";

describe("createOpenAiCompatEmbedding", () => {
  it("posts texts and returns embeddings in index order", async () => {
    let body = "";
    const fetchImpl: typeof fetch = async (_url, init) => {
      body = String(init?.body);
      return new Response(
        JSON.stringify({
          data: [
            { index: 1, embedding: [0, 1] },
            { index: 0, embedding: [1, 0] },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
    const embedding = createOpenAiCompatEmbedding({
      baseUrl: "https://example.com/v1",
      apiKey: "sk-test",
      model: "text-embedding-v3",
      fetchImpl,
    });
    const vectors = await embedding.embed(
      { texts: ["first", "second"] },
      new AbortController().signal,
    );
    expect(JSON.parse(body)).toEqual({
      model: "text-embedding-v3",
      input: ["first", "second"],
    });
    expect(vectors).toEqual([
      [1, 0],
      [0, 1],
    ]);
  });
});
