import type { EmbeddingInput, EmbeddingProvider } from "@flintloom/models";

export type OpenAiCompatEmbeddingOptions = {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
};

export function createOpenAiCompatEmbedding(
  opts: OpenAiCompatEmbeddingOptions,
): EmbeddingProvider {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const base = opts.baseUrl.replace(/\/$/, "");
  return {
    async embed(input: EmbeddingInput, signal: AbortSignal): Promise<number[][]> {
      const res = await fetchImpl(`${base}/embeddings`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: opts.model,
          input: input.texts,
        }),
        signal,
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 240)}`);
      }
      const parsed: unknown = JSON.parse(text);
      if (parsed === null || typeof parsed !== "object" || !("data" in parsed)) {
        throw new Error("bad embeddings response");
      }
      const data = (parsed as { data: unknown }).data;
      if (!Array.isArray(data)) {
        throw new Error("bad embeddings data");
      }
      const rows = data
        .map((row) => {
          if (row === null || typeof row !== "object") {
            return undefined;
          }
          const index = (row as { index?: unknown }).index;
          const embedding = (row as { embedding?: unknown }).embedding;
          if (typeof index !== "number" || !Array.isArray(embedding)) {
            return undefined;
          }
          return { index, embedding: embedding as number[] };
        })
        .filter((row) => row !== undefined);
      rows.sort((a, b) => a!.index - b!.index);
      return rows.map((row) => row!.embedding);
    },
  };
}
