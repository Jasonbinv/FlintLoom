import { describe, expect, it } from "vitest";
import { resolveSearchProvider, searchWeb, type SearchConfig } from "../src/search.ts";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("resolveSearchProvider", () => {
  it("uses explicit provider when its credential exists", () => {
    expect(
      resolveSearchProvider({
        provider: "brave",
        braveApiKey: "b",
        tavilyApiKey: "t",
      }),
    ).toBe("brave");
  });

  it("returns undefined when explicit provider is missing credential", () => {
    expect(resolveSearchProvider({ provider: "tavily", braveApiKey: "b" })).toBeUndefined();
  });

  it("auto-picks searxng then tavily then brave then bocha", () => {
    expect(resolveSearchProvider({ tavilyApiKey: "t", braveApiKey: "b" })).toBe("tavily");
    expect(resolveSearchProvider({ searxngUrl: "http://127.0.0.1:8080/" })).toBe("searxng");
  });
});

describe("searchWeb", () => {
  it("maps searxng json and strips trailing slash", async () => {
    const seen: string[] = [];
    const config: SearchConfig = {
      searxngUrl: "http://127.0.0.1:8080/",
      fetch: async (input) => {
        seen.push(String(input));
        return jsonResponse(200, {
          results: [{ title: "Hello", url: "https://ex.test/", content: "snippet" }],
        });
      },
    };
    const out = await searchWeb(config, { query: "hello", count: 3 }, new AbortController().signal);
    expect(out).toEqual({
      ok: true,
      hits: [{ title: "Hello", url: "https://ex.test/", snippet: "snippet" }],
    });
    expect(seen[0]).toContain("http://127.0.0.1:8080/search?");
    expect(seen[0]).not.toContain("8080//");
    expect(seen[0]).not.toContain("language=");
  });

  it("sets SearXNG language=zh-CN for CJK queries", async () => {
    const seen: string[] = [];
    await searchWeb(
      {
        searxngUrl: "http://127.0.0.1:8080",
        fetch: async (input) => {
          seen.push(String(input));
          return jsonResponse(200, { results: [] });
        },
      },
      { query: "今天天气", count: 5 },
      new AbortController().signal,
    );
    expect(seen[0]).toContain("language=zh-CN");
  });

  it("maps tavily / brave / bocha hits", async () => {
    const tavily = await searchWeb(
      {
        tavilyApiKey: "tv",
        fetch: async (_input, init) => {
          const body = JSON.parse(String(init?.body)) as { api_key: string; max_results: number };
          expect(body.api_key).toBe("tv");
          expect(body.max_results).toBe(2);
          return jsonResponse(200, {
            results: [{ title: "T", url: "https://t.test", content: "tc" }],
          });
        },
      },
      { query: "q", count: 2 },
      new AbortController().signal,
    );
    expect(tavily).toEqual({
      ok: true,
      hits: [{ title: "T", url: "https://t.test", snippet: "tc" }],
    });

    const brave = await searchWeb(
      {
        braveApiKey: "br",
        fetch: async (input, init) => {
          expect(String(input)).toContain("api.search.brave.com");
          expect((init?.headers as Record<string, string>)["X-Subscription-Token"]).toBe("br");
          return jsonResponse(200, {
            web: { results: [{ title: "B", url: "https://b.test", description: "bd" }] },
          });
        },
      },
      { query: "q", count: 5 },
      new AbortController().signal,
    );
    expect(brave.ok && brave.hits[0]?.snippet).toBe("bd");

    const bocha = await searchWeb(
      {
        bochaApiKey: "bo",
        fetch: async (_input, init) => {
          expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer bo");
          return jsonResponse(200, {
            data: {
              webPages: { value: [{ name: "Z", url: "https://z.test", snippet: "zs" }] },
            },
          });
        },
      },
      { query: "天气", count: 5 },
      new AbortController().signal,
    );
    expect(bocha).toEqual({
      ok: true,
      hits: [{ title: "Z", url: "https://z.test", snippet: "zs" }],
    });
  });

  it("returns failed: search not configured and failed: search 403", async () => {
    expect(await searchWeb({}, { query: "q", count: 5 }, new AbortController().signal)).toEqual({
      ok: false,
      error: "failed: search not configured",
    });
    const forbidden = await searchWeb(
      {
        tavilyApiKey: "tv",
        fetch: async () => jsonResponse(403, { error: "no" }),
      },
      { query: "q", count: 5 },
      new AbortController().signal,
    );
    expect(forbidden).toEqual({ ok: false, error: "failed: search 403" });
  });
});
