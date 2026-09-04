import { describe, expect, it } from "vitest";
import { Context } from "@flintloom/kernel";
import type { LoopService, RunTurnInput } from "@flintloom/loop";
import sessionPlugin from "@flintloom/session";
import channelPlugin, { type ChannelRegistry } from "@flintloom/channel";
import slackPlugin from "../src/index.ts";
import { createSlackAdapter } from "../src/adapter.ts";
import type { SlackConfig } from "../src/config.ts";

function mockParsed(apiFetch: SlackConfig["apiFetch"]): SlackConfig {
  return {
    token: "xoxb-tok",
    allowedChannelIds: new Set(["C01234567"]),
    poll: false,
    workspaceRoot: undefined,
    apiFetch,
  };
}

describe("createSlackAdapter", () => {
  it("calls runTurn with channel slack and no onEvent", async () => {
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
    const adapter = createSlackAdapter(ctx, mockParsed(globalThis.fetch));
    const result = await adapter.inbound({
      text: "hi",
      sessionId: "slack:C01234567",
      workspaceRoot: "/tmp",
      signal: new AbortController().signal,
    });
    expect(captured?.channel).toBe("slack");
    expect(captured?.onEvent).toBeUndefined();
    expect(captured?.session.id).toBe("slack:C01234567");
    expect(result).toEqual({ turnId: "t1", status: "ok", text: "hello" });
  });

  it("send posts chat.postMessage for slack sessionId and truncates long text", async () => {
    const ctx = new Context();
    ctx.plugin(sessionPlugin);
    ctx.provide("loop", {
      runTurn: async () => ({ turnId: "t", status: "ok" as const }),
      continueTurn: async () => ({ turnId: "t", status: "ok" as const }),
      continueGuardTurn: async () => ({ turnId: "t", status: "ok" as const }),
    });
    let body: string | undefined;
    let callCount = 0;
    const parsed = mockParsed(async (_url, init) => {
      callCount += 1;
      body = typeof init?.body === "string" ? init.body : undefined;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const adapter = createSlackAdapter(ctx, parsed);
    const long = "a".repeat(5000);
    await adapter.send!({
      sessionId: "slack:C01234567",
      text: long,
      signal: new AbortController().signal,
    });
    expect(JSON.parse(body!)).toEqual({
      channel: "C01234567",
      text: long.slice(0, 4000),
    });
    await adapter.send!({
      sessionId: "slack:C01234567",
      text: "",
      signal: new AbortController().signal,
    });
    expect(callCount).toBe(1);
  });

  it("deliver posts chat.postMessage from session assistant text", async () => {
    const ctx = new Context();
    ctx.plugin(sessionPlugin);
    const sessions = ctx.require<import("@flintloom/session").SessionStore>("sessions");
    const session = sessions.getOrCreate("slack:C01234567");
    session.append({ type: "turn/start", turnId: "t1" });
    session.append({ type: "assistant/message", text: "from-deliver" });
    ctx.provide("loop", {
      runTurn: async () => ({ turnId: "t1", status: "ok" as const }),
      continueTurn: async () => ({ turnId: "t", status: "ok" as const }),
      continueGuardTurn: async () => ({ turnId: "t", status: "ok" as const }),
    });
    let body: string | undefined;
    const parsed = mockParsed(async (_url, init) => {
      body = typeof init?.body === "string" ? init.body : undefined;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const adapter = createSlackAdapter(ctx, parsed);
    await adapter.deliver!({
      sessionId: "slack:C01234567",
      turnId: "t1",
      signal: new AbortController().signal,
    });
    expect(JSON.parse(body!)).toEqual({
      channel: "C01234567",
      text: "from-deliver",
    });
  });

  it("apply registers slack and stop unregisters", async () => {
    const ctx = new Context();
    await ctx.plugin(sessionPlugin);
    ctx.provide("loop", {
      runTurn: async () => ({ turnId: "t", status: "ok" as const }),
      continueTurn: async () => ({ turnId: "t", status: "ok" as const }),
      continueGuardTurn: async () => ({ turnId: "t", status: "ok" as const }),
    });
    await ctx.plugin(channelPlugin);
    const stop = await ctx.plugin(slackPlugin, {
      token: "xoxb-tok",
      allowedChannelIds: ["C01234567"],
    });
    const channels = ctx.require<ChannelRegistry>("channels");
    expect(channels.has("slack")).toBe(true);
    stop();
    expect(channels.has("slack")).toBe(false);
  });
});
