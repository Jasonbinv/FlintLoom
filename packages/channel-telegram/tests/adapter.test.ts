import { describe, expect, it } from "vitest";
import { Context } from "@flintloom/kernel";
import type { LoopService, RunTurnInput } from "@flintloom/loop";
import sessionPlugin from "@flintloom/session";
import channelPlugin, { type ChannelRegistry } from "@flintloom/channel";
import telegramPlugin, { createTelegramAdapter } from "../src/index.ts";

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
    const adapter = createTelegramAdapter(ctx);
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
