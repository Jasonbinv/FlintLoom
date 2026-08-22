import { describe, expect, it } from "vitest";
import { createDashscopeT2i } from "../src/dashscope.ts";

describe("createDashscopeT2i", () => {
  it("downloads image url from multimodal response", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      calls.push(String(url));
      if (String(url).includes("multimodal-generation")) {
        return new Response(
          JSON.stringify({
            output: {
              choices: [
                {
                  message: {
                    content: [{ image: "https://example.com/img.png" }],
                  },
                },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "Content-Type": "image/png" },
      });
    };
    const t2i = createDashscopeT2i({
      origin: "https://dashscope.aliyuncs.com",
      apiKey: "sk-test",
      model: "qwen-image-2.0-pro",
      fetchImpl,
    });
    const result = await t2i.generate({ prompt: "a cat" }, new AbortController().signal);
    expect(result.mimeType).toContain("image");
    expect(result.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(calls.some((u) => u.includes("multimodal-generation"))).toBe(true);
    expect(calls.some((u) => u.includes("example.com/img.png"))).toBe(true);
  });
});
