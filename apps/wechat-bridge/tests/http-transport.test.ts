import { describe, expect, it, vi } from "vitest";
import { createBridgeFromConfig } from "../src/bridge.ts";
import { startHttpTransport } from "../src/transports/http.ts";

describe("http transport", () => {
  it("accepts inbound and returns hook reply", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ turnId: "t1", status: "ok", text: "from flint" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const bridge = createBridgeFromConfig({
      hookUrl: "http://127.0.0.1:7331/v1/hooks",
      hostToken: "tok",
      allowedFrom: undefined,
      fetchImpl,
    });
    const { url, close } = await startHttpTransport({
      host: "127.0.0.1",
      port: 0,
      secret: "bridge-secret",
      bridge,
    });

    const res = await fetch(`${url}/v1/inbound`, {
      method: "POST",
      headers: {
        Authorization: "Bearer bridge-secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: "wxid_test", text: "ping" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reply: string };
    expect(body.reply).toBe("from flint");
    expect(fetchImpl).toHaveBeenCalledOnce();
    await close();
  });

  it("rejects inbound without bearer when secret is set", async () => {
    const bridge = createBridgeFromConfig({
      hookUrl: "http://127.0.0.1:7331/v1/hooks",
      hostToken: "tok",
      allowedFrom: undefined,
      fetchImpl: vi.fn(),
    });
    const { url, close } = await startHttpTransport({
      host: "127.0.0.1",
      port: 0,
      secret: "bridge-secret",
      bridge,
    });
    const res = await fetch(`${url}/v1/inbound`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: "wxid_test", text: "ping" }),
    });
    expect(res.status).toBe(401);
    await close();
  });
});
