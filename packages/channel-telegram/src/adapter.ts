import type { Context } from "@flintloom/kernel";
import type { ChannelAdapter } from "@flintloom/channel";
import type { LoopService } from "@flintloom/loop";
import type { SessionStore } from "@flintloom/session";
import { botPost } from "./bot.ts";
import type { TelegramConfig } from "./config.ts";
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

  async function sendText(
    sessionId: string,
    text: string,
    signal: AbortSignal,
  ): Promise<void> {
    const chatId = telegramChatId(sessionId);
    if (chatId === undefined) {
      throw new Error("bad sessionId");
    }
    if (text.length === 0) {
      return;
    }
    const outbound =
      text.length > 4096 ? text.slice(0, 4096) : text;
    await botPost(
      parsed,
      "sendMessage",
      { chat_id: chatId, text: outbound },
      signal,
    );
  }

  return {
    async inbound(input) {
      const session = sessions.getOrCreate(input.sessionId);
      const result = await loop.runTurn({
        ctx,
        session,
        text: input.text,
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
      await sendText(outbound.sessionId, outbound.text, outbound.signal);
    },
    async deliver(outbound) {
      const session = sessions.get(outbound.sessionId);
      if (session === undefined) {
        throw new Error("session");
      }
      const text = lastAssistantText(session.events(), outbound.turnId);
      await sendText(outbound.sessionId, text, outbound.signal);
    },
  };
}
