import { describe, expect, it } from "vitest";
import { createOpenAiCompatGuard } from "../src/classify.ts";

describe("createOpenAiCompatGuard", () => {
  it("parses gate JSON decision", async () => {
    const guard = createOpenAiCompatGuard({
      baseUrl: "http://127.0.0.1:9",
      apiKey: "k",
      model: "m",
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"decision":"deny"}' } }],
        }),
        { status: 200 },
      );
    try {
      const decision = await guard.gate(
        {
          tool: "shell",
          args: { cmd: "rm -rf /" },
          workspaceRoot: "/ws",
          channel: "host",
        },
        new AbortController().signal,
      );
      expect(decision).toBe("deny");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("parses steward suspicious verdict", async () => {
    const guard = createOpenAiCompatGuard({
      baseUrl: "http://127.0.0.1:9",
      apiKey: "k",
      model: "m",
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '{"verdict":"suspicious","summary":"api key in output"}',
              },
            },
          ],
        }),
        { status: 200 },
      );
    try {
      const result = await guard.steward(
        {
          tool: "fs",
          args: {},
          resultText: "sk-secret123456789",
          workspaceRoot: "/ws",
          channel: "host",
        },
        new AbortController().signal,
      );
      expect(result.verdict).toBe("suspicious");
      expect(result.summary).toContain("api key");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
