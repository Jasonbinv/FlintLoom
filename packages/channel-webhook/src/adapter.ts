import type { Context } from "@flintloom/kernel";
import type { ChannelAdapter } from "@flintloom/channel";
import type { LoopService } from "@flintloom/loop";
import type { SessionStore } from "@flintloom/session";
import { lastAssistantText } from "./text.ts";

export function createWebhookAdapter(ctx: Context): ChannelAdapter {
  const sessions = ctx.require<SessionStore>("sessions");
  const loop = ctx.require<LoopService>("loop");
  return {
    async inbound(input) {
      const session = sessions.getOrCreate(input.sessionId);
      const result = await loop.runTurn({
        ctx,
        session,
        text: input.text,
        workspaceRoot: input.workspaceRoot,
        channel: "webhook",
        signal: input.signal,
      });
      return {
        turnId: result.turnId,
        status: result.status,
        text: lastAssistantText(session.events(), result.turnId),
      };
    },
  };
}
