import { describe, expect, it } from "vitest";
import { Context } from "@flintloom/kernel";
import type { LoopService, RunTurnInput } from "@flintloom/loop";
import sessionPlugin from "@flintloom/session";
import channelPlugin, { type ChannelRegistry } from "@flintloom/channel";
import discordPlugin from "../src/index.ts";
import { createDiscordAdapter } from "../src/adapter.ts";
import type { DiscordConfig } from "../src/config.ts";

function mockParsed(apiFetch: DiscordConfig["apiFetch"]): DiscordConfig {
  return {
    token: "discordtok",
    allowedChannelIds: new Set(["999"]),
    poll: false,
    workspaceRoot: undefined,
    apiFetch,
  };
}

describe("createDiscordAdapter", () => {
  it("calls runTurn with channel discord and no onEvent", async () => {
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
    const adapter = createDiscordAdapter(ctx, mockParsed(globalThis.fetch));
    const result = await adapter.inbound({
      text: "hi",
      sessionId: "discord:999",
      workspaceRoot: "/tmp",
      signal: new AbortController().signal,
    });
    expect(captured?.channel).toBe("discord");
    expect(captured?.onEvent).toBeUndefined();
    expect(captured?.session.id).toBe("discord:999");
    expect(result).toEqual({ turnId: "t1", status: "ok", text: "hello" });
  });

  it("send posts channel message for discord sessionId and truncates long text", async () => {
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
      return new Response(JSON.stringify({ id: "1" }), { status: 200 });
    });
    const adapter = createDiscordAdapter(ctx, parsed);
    const long = "a".repeat(3000);
    await adapter.send!({
      sessionId: "discord:999",
      text: long,
      signal: new AbortController().signal,
    });
    expect(JSON.parse(body!)).toEqual({ content: long.slice(0, 2000) });
    await adapter.send!({
      sessionId: "discord:999",
      text: "",
      signal: new AbortController().signal,
    });
    expect(callCount).toBe(1);
  });

  it("deliver posts channel message from session assistant text", async () => {
    const ctx = new Context();
    ctx.plugin(sessionPlugin);
    const sessions = ctx.require<import("@flintloom/session").SessionStore>("sessions");
    const session = sessions.getOrCreate("discord:999");
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
      return new Response(JSON.stringify({ id: "1" }), { status: 200 });
    });
    const adapter = createDiscordAdapter(ctx, parsed);
    await adapter.deliver!({
      sessionId: "discord:999",
      turnId: "t1",
      signal: new AbortController().signal,
    });
    expect(JSON.parse(body!)).toEqual({ content: "from-deliver" });
  });

  it("apply registers discord and stop unregisters", async () => {
    const ctx = new Context();
    await ctx.plugin(sessionPlugin);
    ctx.provide("loop", {
      runTurn: async () => ({ turnId: "t", status: "ok" as const }),
      continueTurn: async () => ({ turnId: "t", status: "ok" as const }),
      continueGuardTurn: async () => ({ turnId: "t", status: "ok" as const }),
    });
    await ctx.plugin(channelPlugin);
    const stop = await ctx.plugin(discordPlugin, {
      token: "discordtok",
      allowedChannelIds: ["999"],
    });
    const channels = ctx.require<ChannelRegistry>("channels");
    expect(channels.has("discord")).toBe(true);
    stop();
    expect(channels.has("discord")).toBe(false);
  });
});
