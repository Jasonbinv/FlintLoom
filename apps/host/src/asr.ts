import type { IncomingMessage } from "node:http";
import type { Context } from "@flintloom/kernel";
import { type ModelRegistry } from "@flintloom/models";

export const ASR_MAX_BYTES = 10_000_000;

export async function readBodyBytes(
  req: IncomingMessage,
  maxBytes: number,
): Promise<Uint8Array | "too_large"> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    total += buf.length;
    if (total > maxBytes) {
      return "too_large";
    }
    chunks.push(buf);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

export async function transcribeAudio(
  ctx: Context,
  audio: Uint8Array,
  mimeType: string,
  signal: AbortSignal,
): Promise<string> {
  return await ctx.require<ModelRegistry>("models").resolveAsr().transcribe(
    { audio, mimeType },
    signal,
  );
}
