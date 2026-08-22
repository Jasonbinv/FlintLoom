import { describe, expect, it } from "vitest";
import { Context } from "@flintloom/kernel";
import type { LoopService, RunTurnInput } from "@flintloom/loop";
import sessionPlugin from "@flintloom/session";
import channelPlugin, { type ChannelRegistry } from "@flintloom/channel";
import telegramPlugin, { createTelegramAdapter } from "../src/index.ts";
import type { TelegramConfig } from "../src/config.ts";

function mockParsed(apiFetch: TelegramConfig["apiFetch"]): TelegramConfig {
  return {
    token: "tok",
    allowedChatIds: new Set(["1"]),
    poll: false,
    workspaceRoot: undefined,
    apiFetch,
  };
}

describe("createTelegramAdapter", () => {
  it("calls runTurn with channel telegram and no onEvent", async () => {
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
    const adapter = createTelegramAdapter(ctx, mockParsed(globalThis.fetch));
    const result = await adapter.inbound({
      text: "hi",
      sessionId: "telegram:1",
      workspaceRoot: "/tmp",
      signal: new AbortController().signal,
    });
    expect(captured?.channel).toBe("telegram");
    expect(captured?.onEvent).toBeUndefined();
    expect(captured?.session.id).toBe("telegram:1");
    expect(result).toEqual({ turnId: "t1", status: "ok", text: "hello" });
  });

  it("send posts sendMessage for telegram sessionId and truncates long text", async () => {
    const ctx = new Context();
    ctx.plugin(sessionPlugin);
    ctx.provide("loop", {
      runTurn: async () => ({ turnId: "t", status: "ok" as const }),
      continueTurn: async () => ({ turnId: "t", status: "ok" as const }),
    });
    let body: string | undefined;
    let callCount = 0;
    const parsed = mockParsed(async (url, init) => {
      callCount += 1;
      body = typeof init?.body === "string" ? init.body : undefined;
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      } as Response;
    });
    const adapter = createTelegramAdapter(ctx, parsed);
    const long = "a".repeat(5000);
    await adapter.send!({
      sessionId: "telegram:42",
      text: long,
      signal: new AbortController().signal,
    });
    expect(JSON.parse(body!)).toEqual({
      chat_id: 42,
      text: long.slice(0, 4096),
    });
    await adapter.send!({
      sessionId: "telegram:42",
      text: "",
      signal: new AbortController().signal,
    });
    expect(callCount).toBe(1);
  });

  it("deliver posts sendMessage from session assistant text", async () => {
    const ctx = new Context();
    ctx.plugin(sessionPlugin);
    const sessions = ctx.require<import("@flintloom/session").SessionStore>("sessions");
    const session = sessions.getOrCreate("telegram:7");
    session.append({ type: "turn/start", turnId: "t1" });
    session.append({ type: "assistant/message", text: "from-deliver" });
    ctx.provide("loop", {
      runTurn: async () => ({ turnId: "t1", status: "ok" as const }),
      continueTurn: async () => ({ turnId: "t", status: "ok" as const }),
    });
    let body: string | undefined;
    const parsed = mockParsed(async (_url, init) => {
      body = typeof init?.body === "string" ? init.body : undefined;
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      } as Response;
    });
    const adapter = createTelegramAdapter(ctx, parsed);
    await adapter.deliver!({
      sessionId: "telegram:7",
      turnId: "t1",
      signal: new AbortController().signal,
    });
    expect(JSON.parse(body!)).toEqual({ chat_id: 7, text: "from-deliver" });
  });

  it("apply registers telegram and stop unregisters", async () => {
    const ctx = new Context();
    await ctx.plugin(sessionPlugin);
    ctx.provide("loop", {
      runTurn: async () => ({ turnId: "t", status: "ok" as const }),
      continueTurn: async () => ({ turnId: "t", status: "ok" as const }),
    });
    await ctx.plugin(channelPlugin);
    const stop = await ctx.plugin(telegramPlugin, {
      token: "tok",
      allowedChatIds: [1],
    });
    const channels = ctx.require<ChannelRegistry>("channels");
    expect(channels.has("telegram")).toBe(true);
    stop();
    expect(channels.has("telegram")).toBe(false);
  });
});
