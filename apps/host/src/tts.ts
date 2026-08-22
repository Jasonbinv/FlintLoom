import type { Context } from "@flintloom/kernel";
import { type ModelRegistry } from "@flintloom/models";

const TTS_MAX_CHARS = 2000;

export async function synthesizeSpeech(
  ctx: Context,
  text: string,
  signal: AbortSignal,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new Error("text required");
  }
  const clipped =
    trimmed.length > TTS_MAX_CHARS ? trimmed.slice(0, TTS_MAX_CHARS) : trimmed;
  const media = await ctx.require<ModelRegistry>("models").resolveTts().synthesize(
    { text: clipped },
    signal,
  );
  return { bytes: media.bytes, mimeType: media.mimeType };
}
