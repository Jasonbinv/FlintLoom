import { afterEach, describe, expect, it } from "vitest";
import { Context } from "@flintloom/kernel";
import type { LoopService, RunTurnInput } from "@flintloom/loop";
import sessionPlugin from "@flintloom/session";
import channelPlugin, { type ChannelRegistry } from "@flintloom/channel";
import feishuPlugin from "../src/index.ts";
import { createFeishuAdapter } from "../src/adapter.ts";
import { resetFeishuTokenCache } from "../src/api.ts";
import type { FeishuConfig } from "../src/config.ts";

function mockParsed(apiFetch: FeishuConfig["apiFetch"]): FeishuConfig {
  return {
    appId: "cli_test",
    appSecret: "secret",
    allowedChatIds: new Set(["oc_test_chat"]),
    poll: false,
    workspaceRoot: undefined,
    apiFetch,
  };
}

describe("createFeishuAdapter", () => {
  afterEach(() => {
    resetFeishuTokenCache();
  });

  it("calls runTurn with channel feishu and no onEvent", async () => {
    const ctx = new Context();
    ctx.plugin(sessionPlugin);
    let captured: RunTurnInput | undefined;
    const loop: LoopService = {
      async runTurn(input) {
        captured = input;
        input.session.append({ type: "turn/start", turnId: "t1" });
        input.session.append({ type: "user/message", text: input.text });
        input.session.append({ type: "assistant/message", text: "hello" });
        return { turnId: "t1", status: "ok" };
      },
      async continueTurn() {
        throw new Error("continueTurn");
      },
      async continueGuardTurn() {
        throw new Error("continueGuardTurn");
      },
    };
    ctx.provide("loop", loop);
    const adapter = createFeishuAdapter(ctx, mockParsed(globalThis.fetch));
    const result = await adapter.inbound({
      text: "hi",
      sessionId: "feishu:oc_test_chat",
      workspaceRoot: "/tmp",
      signal: new AbortController().signal,
    });
    expect(captured?.channel).toBe("feishu");
    expect(captured?.onEvent).toBeUndefined();
    expect(captured?.session.id).toBe("feishu:oc_test_chat");
    expect(result).toEqual({ turnId: "t1", status: "ok", text: "hello" });
  });

  it("send posts im message for feishu sessionId and truncates long text", async () => {
    const ctx = new Context();
    ctx.plugin(sessionPlugin);
    ctx.provide("loop", {
      runTurn: async () => ({ turnId: "t", status: "ok" as const }),
      continueTurn: async () => ({ turnId: "t", status: "ok" as const }),
      continueGuardTurn: async () => ({ turnId: "t", status: "ok" as const }),
    });
    let body: string | undefined;
    let callCount = 0;
    const parsed = mockParsed(async (url, init) => {
      callCount += 1;
      const u = String(url);
      if (u.includes("tenant_access_token")) {
        return new Response(
          JSON.stringify({ code: 0, tenant_access_token: "tok", expire: 7200 }),
          { status: 200 },
        );
      }
      body = typeof init?.body === "string" ? init.body : undefined;
      return new Response(JSON.stringify({ code: 0 }), { status: 200 });
    });
    const adapter = createFeishuAdapter(ctx, parsed);
    const long = "a".repeat(5000);
    await adapter.send!({
      sessionId: "feishu:oc_test_chat",
      text: long,
      signal: new AbortController().signal,
    });
    expect(JSON.parse(body!)).toEqual({
      receive_id: "oc_test_chat",
      msg_type: "text",
      content: JSON.stringify({ text: long.slice(0, 4000) }),
    });
    await adapter.send!({
      sessionId: "feishu:oc_test_chat",
      text: "",
      signal: new AbortController().signal,
    });
    expect(callCount).toBe(2);
  });

  it("deliver posts im message from session assistant text", async () => {
    const ctx = new Context();
    ctx.plugin(sessionPlugin);
    const sessions = ctx.require<import("@flintloom/session").SessionStore>("sessions");
    const session = sessions.getOrCreate("feishu:oc_test_chat");
    session.append({ type: "turn/start", turnId: "t1" });
    session.append({ type: "assistant/message", text: "from-deliver" });
    ctx.provide("loop", {
      runTurn: async () => ({ turnId: "t1", status: "ok" as const }),
      continueTurn: async () => ({ turnId: "t", status: "ok" as const }),
      continueGuardTurn: async () => ({ turnId: "t", status: "ok" as const }),
    });
    let body: string | undefined;
    const parsed = mockParsed(async (url, init) => {
      const u = String(url);
      if (u.includes("tenant_access_token")) {
        return new Response(
          JSON.stringify({ code: 0, tenant_access_token: "tok", expire: 7200 }),
          { status: 200 },
        );
      }
      body = typeof init?.body === "string" ? init.body : undefined;
      return new Response(JSON.stringify({ code: 0 }), { status: 200 });
    });
    const adapter = createFeishuAdapter(ctx, parsed);
    await adapter.deliver!({
      sessionId: "feishu:oc_test_chat",
      turnId: "t1",
      signal: new AbortController().signal,
    });
    expect(JSON.parse(body!)).toEqual({
      receive_id: "oc_test_chat",
      msg_type: "text",
      content: JSON.stringify({ text: "from-deliver" }),
    });
  });

  it("apply registers feishu and stop unregisters", async () => {
    const ctx = new Context();
    await ctx.plugin(sessionPlugin);
    ctx.provide("loop", {
      runTurn: async () => ({ turnId: "t", status: "ok" as const }),
      continueTurn: async () => ({ turnId: "t", status: "ok" as const }),
      continueGuardTurn: async () => ({ turnId: "t", status: "ok" as const }),
    });
    await ctx.plugin(channelPlugin);
    const stop = await ctx.plugin(feishuPlugin, {
      appId: "cli_test",
      appSecret: "secret",
      allowedChatIds: ["oc_test_chat"],
    });
    const channels = ctx.require<ChannelRegistry>("channels");
    expect(channels.has("feishu")).toBe(true);
    stop();
    expect(channels.has("feishu")).toBe(false);
  });
});
