import type { Context } from "@flintloom/kernel";
import { ModelKindMissingError, type ModelRegistry } from "@flintloom/models";
import type { UserImage } from "@flintloom/session";

export type PromptContent = {
  text: string;
  images?: UserImage[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

function decodeBase64(data: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(data, "base64"));
  }
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function imageFromBlock(block: Record<string, unknown>): UserImage | undefined {
  const mime =
    typeof block.mimeType === "string"
      ? block.mimeType
      : typeof block.mime === "string"
        ? block.mime
        : undefined;
  const data = typeof block.data === "string" ? block.data : undefined;
  if (mime === undefined || data === undefined || !mime.startsWith("image/")) {
    return undefined;
  }
  return { mime, data: data.trim() };
}

export function promptCapabilities(ctx: Context): {
  image: boolean;
  audio: boolean;
  embeddedContext: boolean;
} {
  const models = ctx.get<ModelRegistry>("models");
  if (models === undefined) {
    return { image: false, audio: false, embeddedContext: false };
  }
  const snapshot = models.snapshot();
  const omni = snapshot.some((row) => row.kind === "omni" && row.configured);
  const asr = snapshot.some((row) => row.kind === "asr" && row.configured);
  return {
    image: omni,
    audio: asr,
    embeddedContext: omni,
  };
}

export async function promptContent(
  ctx: Context,
  prompt: unknown,
  signal: AbortSignal,
): Promise<PromptContent | undefined> {
  if (!Array.isArray(prompt)) {
    return undefined;
  }
  const textParts: string[] = [];
  const images: UserImage[] = [];

  for (const block of prompt) {
    if (!isRecord(block)) {
      continue;
    }
    const type = block.type;
    if (type === "text" && typeof block.text === "string") {
      textParts.push(block.text);
      continue;
    }
    if (type === "image") {
      const image = imageFromBlock(block);
      if (image !== undefined) {
        images.push(image);
      }
      continue;
    }
    if (type === "audio") {
      const mime =
        typeof block.mimeType === "string"
          ? block.mimeType
          : typeof block.mime === "string"
            ? block.mime
            : "audio/ogg";
      const data = typeof block.data === "string" ? block.data.trim() : undefined;
      if (data === undefined || data.length === 0) {
        continue;
      }
      try {
        const text = await ctx.require<ModelRegistry>("models").resolveAsr().transcribe(
          { audio: decodeBase64(data), mimeType: mime },
          signal,
        );
        const trimmed = text.trim();
        if (trimmed.length > 0) {
          textParts.push(trimmed);
        }
      } catch (err) {
        if (err instanceof ModelKindMissingError) {
          continue;
        }
        throw err;
      }
      continue;
    }
    if (type === "embedded_context" && typeof block.text === "string") {
      const trimmed = block.text.trim();
      if (trimmed.length > 0) {
        textParts.push(trimmed);
      }
    }
  }

  const text = textParts.join("\n").trim();
  if (text.length === 0 && images.length === 0) {
    return undefined;
  }
  return {
    text,
    images: images.length > 0 ? images : undefined,
  };
}

export function audioBytesToBase64(bytes: Uint8Array): string {
  return bytesToBase64(bytes);
}
