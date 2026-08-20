import { describe, expect, it } from "vitest";
import { Context } from "@flintloom/kernel";
import loopPlugin, { runTurn } from "@flintloom/loop";
import modelsPlugin, {
  type ChatProvider,
  type ModelRegistry,
} from "@flintloom/models";
import sessionPlugin, { type SessionStore } from "@flintloom/session";
import toolsPlugin from "@flintloom/tools";
import channelPlugin, { type ChannelRegistry } from "@flintloom/channel";
import type { SessionEvent } from "@flintloom/session";
import webhookPlugin from "../src/index.ts";

function textChat(reply: string): ChatProvider {
  return {
    async *stream() {
      yield { type: "text", text: reply };
    },
  };
}

function stripTurnId(events: readonly SessionEvent[]): unknown[] {
  return events.map((event) => {
    if (!("turnId" in event)) {
      return event;
    }
    const { turnId, ...rest } = event;
    return rest;
  });
}

function boot() {
  const ctx = new Context();
  ctx.plugin(modelsPlugin);
  ctx.plugin(toolsPlugin);
  ctx.plugin(sessionPlugin);
  ctx.plugin(loopPlugin);
  ctx.plugin(channelPlugin);
  ctx.plugin(webhookPlugin);
  const models = ctx.require<ModelRegistry>("models");
  models.registerChat("fake", textChat("hello-iso"));
  models.setDefault("chat", "fake");
  return ctx;
}

describe("webhook inbound events", () => {
  it("matches host runTurn events for the same text without a2ui wait", async () => {
    const ctx = boot();
    const sessions = ctx.require<SessionStore>("sessions");
    const inbound = await ctx.require<ChannelRegistry>("channels").inbound("webhook", {
      text: "same-text",
      sessionId: "wh",
      workspaceRoot: process.cwd(),
      signal: new AbortController().signal,
    });
    expect(inbound.status).toBe("ok");
    expect(inbound.text).toBe("hello-iso");
    const hostSession = sessions.getOrCreate("host-iso");
    await runTurn({
      ctx,
      session: hostSession,
      text: "same-text",
      workspaceRoot: process.cwd(),
      channel: "host",
      signal: new AbortController().signal,
    });
    const webhookEvents = sessions.get("wh")!.events();
    expect(stripTurnId(webhookEvents)).toEqual(stripTurnId(hostSession.events()));
  });
});
