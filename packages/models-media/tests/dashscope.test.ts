import { describe, expect, it } from "vitest";
import { createDashscopeT2i, createDashscopeT2v } from "../src/dashscope.ts";

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

describe("createDashscopeT2v", () => {
  it("polls async task_id until SUCCEEDED and downloads video", async () => {
    const calls: string[] = [];
    let pollCount = 0;
    const fetchImpl: typeof fetch = async (url) => {
      calls.push(String(url));
      if (String(url).includes("video-generation")) {
        return new Response(
          JSON.stringify({
            output: { task_id: "task-abc" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (String(url).includes("/api/v1/tasks/task-abc")) {
        pollCount += 1;
        const status = pollCount >= 2 ? "SUCCEEDED" : "RUNNING";
        return new Response(
          JSON.stringify({
            output: {
              task_id: "task-abc",
              task_status: status,
              ...(status === "SUCCEEDED"
                ? { video_url: "https://example.com/vid.mp4" }
                : {}),
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(new Uint8Array([4, 5, 6]), {
        status: 200,
        headers: { "Content-Type": "video/mp4" },
      });
    };
    const t2v = createDashscopeT2v({
      origin: "https://dashscope.aliyuncs.com",
      apiKey: "sk-test",
      model: "wan2.1-t2v-turbo",
      fetchImpl,
      t2vPollIntervalMs: 1,
    });
    const result = await t2v.generate({ prompt: "a dog" }, new AbortController().signal);
    expect(result.mimeType).toContain("video");
    expect(result.bytes).toEqual(new Uint8Array([4, 5, 6]));
    expect(calls.some((u) => u.includes("video-generation"))).toBe(true);
    expect(calls.filter((u) => u.includes("/api/v1/tasks/task-abc")).length).toBe(2);
    expect(calls.some((u) => u.includes("example.com/vid.mp4"))).toBe(true);
  });

  it("throws when async task FAILED", async () => {
    const fetchImpl: typeof fetch = async (url) => {
      if (String(url).includes("video-generation")) {
        return new Response(
          JSON.stringify({ output: { task_id: "task-fail" } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (String(url).includes("/api/v1/tasks/task-fail")) {
        return new Response(
          JSON.stringify({
            output: { task_status: "FAILED", message: "bad prompt" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error("unexpected");
    };
    const t2v = createDashscopeT2v({
      origin: "https://dashscope.aliyuncs.com",
      apiKey: "sk-test",
      model: "wan2.1-t2v-turbo",
      fetchImpl,
      t2vPollIntervalMs: 1,
    });
    await expect(
      t2v.generate({ prompt: "x" }, new AbortController().signal),
    ).rejects.toThrow(/t2v failed: bad prompt/);
  });
});
