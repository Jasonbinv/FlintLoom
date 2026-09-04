import type { Context } from "@flintloom/kernel";
import type { ChannelAdapter } from "@flintloom/channel";
import type { LoopService } from "@flintloom/loop";
import type { SessionStore } from "@flintloom/session";
import type { SlackConfig } from "./config.ts";
import { sendSlackText } from "./outbound.ts";
import { lastAssistantText } from "./text.ts";

const SESSION_PREFIX = "slack:";

function slackChannelId(sessionId: string): string | undefined {
  if (!sessionId.startsWith(SESSION_PREFIX)) {
    return undefined;
  }
  const raw = sessionId.slice(SESSION_PREFIX.length);
  return /^[CG][A-Z0-9]+$/.test(raw) ? raw : undefined;
}

export function createSlackAdapter(ctx: Context, parsed: SlackConfig): ChannelAdapter {
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
        channel: "slack",
        signal: input.signal,
      });
      return {
        turnId: result.turnId,
        status: result.status,
        text: lastAssistantText(session.events(), result.turnId),
      };
    },
    async send(outbound) {
      const channelId = slackChannelId(outbound.sessionId);
      if (channelId === undefined) {
        throw new Error("bad sessionId");
      }
      await sendSlackText(parsed, channelId, outbound.text, outbound.signal);
    },
    async deliver(outbound) {
      const session = sessions.get(outbound.sessionId);
      if (session === undefined) {
        throw new Error("session");
      }
      const channelId = slackChannelId(outbound.sessionId);
      if (channelId === undefined) {
        throw new Error("bad sessionId");
      }
      const text = lastAssistantText(session.events(), outbound.turnId);
      await sendSlackText(parsed, channelId, text, outbound.signal);
    },
  };
}
