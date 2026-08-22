import type { Context } from "@flintloom/kernel";
import { ModelKindMissingError, type ModelRegistry } from "@flintloom/models";
import type { TelegramConfig } from "./config.ts";
import { botPost } from "./bot.ts";
import { sendTelegramVoice } from "./outbound.ts";

const TTS_OUTBOUND_MAX = 500;

export async function sendTelegramOutboundText(
  parsed: TelegramConfig,
  chatId: number,
  text: string,
  signal: AbortSignal,
): Promise<void> {
  if (text.length === 0) {
    return;
  }
  const outbound = text.length > 4096 ? text.slice(0, 4096) : text;
  await botPost(parsed, "sendMessage", { chat_id: chatId, text: outbound }, signal);
}

export async function sendTelegramOutbound(
  ctx: Context,
  parsed: TelegramConfig,
  chatId: number,
  text: string,
  signal: AbortSignal,
): Promise<void> {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return;
  }
  const models = ctx.get<ModelRegistry>("models");
  if (models !== undefined) {
    try {
      const tts = models.resolveTts();
      const speakText =
        trimmed.length > TTS_OUTBOUND_MAX ? trimmed.slice(0, TTS_OUTBOUND_MAX) : trimmed;
      const media = await tts.synthesize({ text: speakText }, signal);
      await sendTelegramVoice(parsed, chatId, media.bytes, media.mimeType, signal);
      return;
    } catch (err) {
      if (!(err instanceof ModelKindMissingError)) {
        try {
          await sendTelegramOutboundText(parsed, chatId, trimmed, signal);
          return;
        } catch {
          throw err;
        }
      }
    }
  }
  await sendTelegramOutboundText(parsed, chatId, trimmed, signal);
}
