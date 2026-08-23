import type { Context } from "@flintloom/kernel";
import type { ChannelAdapter } from "@flintloom/channel";
import type { LoopService } from "@flintloom/loop";
import type { SessionStore } from "@flintloom/session";
import type { WecomConfig } from "./config.ts";
import { sendWecomText } from "./outbound.ts";
import { lastAssistantText } from "./text.ts";

const SESSION_PREFIX = "wecom:";

function wecomUserId(sessionId: string): string | undefined {
  if (!sessionId.startsWith(SESSION_PREFIX)) {
    return undefined;
  }
  const raw = sessionId.slice(SESSION_PREFIX.length);
  return /^[\w@.-]+$/.test(raw) ? raw : undefined;
}

export function wecomSessionId(userId: string): string {
  return `${SESSION_PREFIX}${userId}`;
}

export function createWecomAdapter(ctx: Context, parsed: WecomConfig): ChannelAdapter {
  const sessions = ctx.require<SessionStore>("sessions");
  const loop = ctx.require<LoopService>("loop");

  return {
    async inbound(input) {
      const session = sessions.getOrCreate(input.sessionId);
      const result = await loop.runTurn({
        ctx,
        session,
        text: input.text,
        images: input.images,
        workspaceRoot: input.workspaceRoot,
        channel: "wecom",
        signal: input.signal,
      });
      return {
        turnId: result.turnId,
        status: result.status,
        text: lastAssistantText(session.events(), result.turnId),
      };
    },
    async send(outbound) {
      const userId = wecomUserId(outbound.sessionId);
      if (userId === undefined) {
        throw new Error("bad sessionId");
      }
      await sendWecomText(parsed, userId, outbound.text, outbound.signal);
    },
    async deliver(outbound) {
      const session = sessions.get(outbound.sessionId);
      if (session === undefined) {
        throw new Error("session");
      }
      const userId = wecomUserId(outbound.sessionId);
      if (userId === undefined) {
        throw new Error("bad sessionId");
      }
      const text = lastAssistantText(session.events(), outbound.turnId);
      await sendWecomText(parsed, userId, text, outbound.signal);
    },
  };
}
