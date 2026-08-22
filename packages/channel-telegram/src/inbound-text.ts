import type { Context } from "@flintloom/kernel";
import { ModelKindMissingError, type ModelRegistry } from "@flintloom/models";
import type { TelegramConfig } from "./config.ts";
import { downloadTelegramVoice } from "./voice.ts";

export type TelegramMessage = {
  chat?: { id?: unknown };
  text?: unknown;
  voice?: { file_id?: unknown };
};

export async function telegramInboundText(
  ctx: Context,
  parsed: TelegramConfig,
  message: TelegramMessage | undefined,
  signal: AbortSignal,
): Promise<string | undefined> {
  if (message === undefined) {
    return undefined;
  }
  if (typeof message.text === "string") {
    const trimmed = message.text.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  const fileId = message.voice?.file_id;
  if (typeof fileId !== "string") {
    return undefined;
  }
  try {
    const { bytes, mimeType } = await downloadTelegramVoice(parsed, fileId, signal);
    const text = await ctx.require<ModelRegistry>("models").resolveAsr().transcribe(
      { audio: bytes, mimeType },
      signal,
    );
    const trimmed = text.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch (err) {
    if (err instanceof ModelKindMissingError) {
      return undefined;
    }
    throw err;
  }
}
