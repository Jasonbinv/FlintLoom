import type { TelegramConfig } from "./config.ts";
import { downloadTelegramFile } from "./file.ts";

export async function downloadTelegramVoice(
  parsed: TelegramConfig,
  fileId: string,
  signal: AbortSignal,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  return downloadTelegramFile(parsed, fileId, signal);
}
