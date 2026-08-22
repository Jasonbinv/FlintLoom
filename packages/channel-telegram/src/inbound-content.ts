import type { Context } from "@flintloom/kernel";
import { ModelKindMissingError, type ModelRegistry } from "@flintloom/models";
import type { UserImage } from "@flintloom/session";
import type { TelegramConfig } from "./config.ts";
import { downloadTelegramFile } from "./file.ts";

export type TelegramMessage = {
  chat?: { id?: unknown };
  text?: unknown;
  voice?: { file_id?: unknown };
  photo?: Array<{ file_id?: unknown }>;
};

export type TelegramInboundContent = {
  text: string;
  images?: UserImage[];
};

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function omniConfigured(models: ModelRegistry): boolean {
  return models.snapshot().some((row) => row.kind === "omni" && row.configured);
}

export async function telegramInboundContent(
  ctx: Context,
  parsed: TelegramConfig,
  message: TelegramMessage | undefined,
  signal: AbortSignal,
): Promise<TelegramInboundContent | undefined> {
  if (message === undefined) {
    return undefined;
  }

  const models = ctx.require<ModelRegistry>("models");
  const caption =
    typeof message.text === "string" ? message.text.trim() : "";

  const photos = message.photo;
  if (Array.isArray(photos) && photos.length > 0) {
    if (!omniConfigured(models)) {
      return undefined;
    }
    const largest = photos[photos.length - 1];
    const fileId = largest?.file_id;
    if (typeof fileId !== "string") {
      return undefined;
    }
    try {
      const { bytes, mimeType } = await downloadTelegramFile(parsed, fileId, signal);
      if (!mimeType.startsWith("image/")) {
        return undefined;
      }
      const image: UserImage = {
        mime: mimeType,
        data: bytesToBase64(bytes),
      };
      return { text: caption, images: [image] };
    } catch (err) {
      if (err instanceof ModelKindMissingError) {
        return undefined;
      }
      throw err;
    }
  }

  if (caption.length > 0) {
    return { text: caption };
  }

  const voiceFileId = message.voice?.file_id;
  if (typeof voiceFileId !== "string") {
    return undefined;
  }
  try {
    const { bytes, mimeType } = await downloadTelegramFile(parsed, voiceFileId, signal);
    const text = await models.resolveAsr().transcribe(
      { audio: bytes, mimeType },
      signal,
    );
    const trimmed = text.trim();
    return trimmed.length > 0 ? { text: trimmed } : undefined;
  } catch (err) {
    if (err instanceof ModelKindMissingError) {
      return undefined;
    }
    throw err;
  }
}
