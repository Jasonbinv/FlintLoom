import { describe, expect, it } from "vitest";
import { createWebSearchTool } from "../src/tool.ts";

const exec = {
  workspaceRoot: ".",
  signal: new AbortController().signal,
  channel: "host",
  webSearch: true,
};

describe("createWebSearchTool", () => {
  it("rejects when webSearch is not true", async () => {
    const tool = createWebSearchTool({ tavilyApiKey: "tv", fetch: async () => new Response("{}") });
    expect(await tool.execute({ query: "q" }, { ...exec, webSearch: false })).toBe(
      "failed: web_search disabled",
    );
    expect(await tool.execute({ query: "q" }, { ...exec, webSearch: undefined })).toBe(
      "failed: web_search disabled",
    );
  });

  it("rejects empty query", async () => {
    const tool = createWebSearchTool({ searxngUrl: "http://127.0.0.1:8080" });
    expect(await tool.execute({ query: "  " }, exec)).toBe("failed: empty query");
  });

  it("formats hits when search succeeds", async () => {
    const tool = createWebSearchTool({
      tavilyApiKey: "tv",
      fetch: async () =>
        new Response(
          JSON.stringify({
            results: [{ title: "A", url: "https://a.test", content: "aa" }],
          }),
        ),
    });
    const text = await tool.execute({ query: "hello", count: 5 }, exec);
    expect(text).toContain("1. A");
    expect(text).toContain("https://a.test");
    expect(text).toContain("aa");
  });
});
