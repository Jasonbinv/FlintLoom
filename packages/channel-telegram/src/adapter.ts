import type { Context } from "@flintloom/kernel";
import type { ChannelAdapter } from "@flintloom/channel";
import type { LoopService } from "@flintloom/loop";
import type { SessionStore } from "@flintloom/session";
import type { TelegramConfig } from "./config.ts";
import { sendTelegramOutbound } from "./outbound-text.ts";
import { lastAssistantText } from "./text.ts";

const SESSION_PREFIX = "telegram:";

function telegramChatId(sessionId: string): number | undefined {
  if (!sessionId.startsWith(SESSION_PREFIX)) {
    return undefined;
  }
  const raw = sessionId.slice(SESSION_PREFIX.length);
  const chatId = Number(raw);
  if (!Number.isSafeInteger(chatId)) {
    return undefined;
  }
  return chatId;
}

export function createTelegramAdapter(ctx: Context, parsed: TelegramConfig): ChannelAdapter {
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
        channel: "telegram",
        signal: input.signal,
      });
      return {
        turnId: result.turnId,
        status: result.status,
        text: lastAssistantText(session.events(), result.turnId),
      };
    },
    async send(outbound) {
      const chatId = telegramChatId(outbound.sessionId);
      if (chatId === undefined) {
        throw new Error("bad sessionId");
      }
      await sendTelegramOutbound(
        ctx,
        parsed,
        chatId,
        outbound.text,
        outbound.signal,
      );
    },
    async deliver(outbound) {
      const session = sessions.get(outbound.sessionId);
      if (session === undefined) {
        throw new Error("session");
      }
      const chatId = telegramChatId(outbound.sessionId);
      if (chatId === undefined) {
        throw new Error("bad sessionId");
      }
      const text = lastAssistantText(session.events(), outbound.turnId);
      await sendTelegramOutbound(ctx, parsed, chatId, text, outbound.signal);
    },
  };
}
