import { describe, expect, it, vi } from "vitest";
import { createBridge } from "../src/bridge.ts";
import type { FlintHookClient } from "../src/flint-hook.ts";
import { wechatSessionId } from "../src/session-id.ts";

describe("createBridge", () => {
  it("forwards allowed messages to hook with wechat session id", async () => {
    const hook: FlintHookClient = {
      call: vi.fn(async (sessionId, text) => {
        expect(sessionId).toBe(wechatSessionId("wxid_a", "room@chatroom"));
        expect(text).toBe("hello");
        return { turnId: "t1", status: "ok", text: "pong" };
      }),
    };
    const bridge = createBridge({
      hook,
      allowedFrom: new Set(["room@chatroom"]),
    });
    const reply = await bridge.handleInbound({
      from: "wxid_a",
      text: "hello",
      room: "room@chatroom",
    });
    expect(reply).toBe("pong");
  });

  it("drops messages from disallowed senders", async () => {
    const hook: FlintHookClient = {
      call: vi.fn(),
    };
    const bridge = createBridge({
      hook,
      allowedFrom: new Set(["wxid_allowed"]),
    });
    const reply = await bridge.handleInbound({ from: "wxid_other", text: "hi" });
    expect(reply).toBe("");
    expect(hook.call).not.toHaveBeenCalled();
  });
});
