import { describe, expect, it, vi } from "vitest";
import { createFlintHookClient } from "../src/flint-hook.ts";

describe("createFlintHookClient", () => {
  it("posts sessionId and text with bearer token", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ turnId: "t1", status: "ok", text: "hello back" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const client = createFlintHookClient({
      hookUrl: "http://127.0.0.1:7331/v1/hooks",
      hostToken: "tok",
      fetchImpl,
    });
    const result = await client.call("wechat:wxid_a", "hi");
    expect(result.text).toBe("hello back");
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:7331/v1/hooks");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer tok",
    });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      sessionId: "wechat:wxid_a",
      text: "hi",
    });
  });

  it("maps 409 to busy error", async () => {
    const fetchImpl = vi.fn(async () => new Response("busy", { status: 409 }));
    const client = createFlintHookClient({
      hookUrl: "http://127.0.0.1:7331/v1/hooks",
      hostToken: "tok",
      fetchImpl,
    });
    await expect(client.call("wechat:a", "x")).rejects.toThrow("busy");
  });
});
