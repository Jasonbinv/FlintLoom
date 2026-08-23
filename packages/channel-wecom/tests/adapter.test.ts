import { afterEach, describe, expect, it } from "vitest";
import { Context } from "@flintloom/kernel";
import type { LoopService, RunTurnInput } from "@flintloom/loop";
import sessionPlugin from "@flintloom/session";
import channelPlugin, { type ChannelRegistry } from "@flintloom/channel";
import wecomPlugin, {
  createWecomAdapter,
  resetWecomTokenCache,
  wecomSessionId,
} from "../src/index.ts";
import type { WecomConfig } from "../src/config.ts";

function mockParsed(apiFetch: WecomConfig["apiFetch"]): WecomConfig {
  return {
    corpId: "ww_test",
    corpSecret: "secret",
    agentId: 1000002,
    callbackToken: "cbtok",
    encodingAesKey: undefined,
    allowedUserIds: new Set(["zhangsan"]),
    workspaceRoot: "/ws",
    apiFetch,
  };
}

describe("wecomSessionId", () => {
  it("prefixes user id", () => {
    expect(wecomSessionId("zhangsan")).toBe("wecom:zhangsan");
  });
});

describe("createWecomAdapter", () => {
  afterEach(() => {
    resetWecomTokenCache();
  });

  it("calls runTurn with channel wecom and no onEvent", async () => {
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
    const adapter = createWecomAdapter(ctx, mockParsed(globalThis.fetch));
    const result = await adapter.inbound({
      text: "hi",
      sessionId: "wecom:zhangsan",
      workspaceRoot: "/tmp",
      signal: new AbortController().signal,
    });
    expect(captured?.channel).toBe("wecom");
    expect(captured?.onEvent).toBeUndefined();
    expect(captured?.session.id).toBe("wecom:zhangsan");
    expect(result).toEqual({ turnId: "t1", status: "ok", text: "hello" });
  });

  it("send posts message/send for wecom sessionId and truncates long text", async () => {
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
      if (u.includes("/gettoken")) {
        return new Response(
          JSON.stringify({ errcode: 0, access_token: "tok", expires_in: 7200 }),
          { status: 200 },
        );
      }
      body = typeof init?.body === "string" ? init.body : undefined;
      return new Response(JSON.stringify({ errcode: 0 }), { status: 200 });
    });
    const adapter = createWecomAdapter(ctx, parsed);
    const long = "a".repeat(3000);
    await adapter.send!({
      sessionId: "wecom:zhangsan",
      text: long,
      signal: new AbortController().signal,
    });
    expect(JSON.parse(body!)).toEqual({
      touser: "zhangsan",
      msgtype: "text",
      agentid: 1000002,
      text: { content: long.slice(0, 2048) },
      safe: 0,
    });
    await adapter.send!({
      sessionId: "wecom:zhangsan",
      text: "",
      signal: new AbortController().signal,
    });
    expect(callCount).toBe(2);
  });

  it("deliver posts message/send from session assistant text", async () => {
    const ctx = new Context();
    ctx.plugin(sessionPlugin);
    const sessions = ctx.require<import("@flintloom/session").SessionStore>("sessions");
    const session = sessions.getOrCreate("wecom:zhangsan");
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
      if (u.includes("/gettoken")) {
        return new Response(
          JSON.stringify({ errcode: 0, access_token: "tok", expires_in: 7200 }),
          { status: 200 },
        );
      }
      body = typeof init?.body === "string" ? init.body : undefined;
      return new Response(JSON.stringify({ errcode: 0 }), { status: 200 });
    });
    const adapter = createWecomAdapter(ctx, parsed);
    await adapter.deliver!({
      sessionId: "wecom:zhangsan",
      turnId: "t1",
      signal: new AbortController().signal,
    });
    expect(JSON.parse(body!)).toEqual({
      touser: "zhangsan",
      msgtype: "text",
      agentid: 1000002,
      text: { content: "from-deliver" },
      safe: 0,
    });
  });

  it("apply registers wecom and stop unregisters", async () => {
    const ctx = new Context();
    await ctx.plugin(sessionPlugin);
    ctx.provide("loop", {
      runTurn: async () => ({ turnId: "t", status: "ok" as const }),
      continueTurn: async () => ({ turnId: "t", status: "ok" as const }),
      continueGuardTurn: async () => ({ turnId: "t", status: "ok" as const }),
    });
    await ctx.plugin(channelPlugin);
    const stop = await ctx.plugin(wecomPlugin, {
      corpId: "ww_test",
      corpSecret: "secret",
      agentId: 1000002,
      callbackToken: "cbtok",
      allowedUserIds: ["zhangsan"],
      workspaceRoot: "/ws",
    });
    const channels = ctx.require<ChannelRegistry>("channels");
    expect(channels.has("wecom")).toBe(true);
    stop();
    expect(channels.has("wecom")).toBe(false);
  });
});
