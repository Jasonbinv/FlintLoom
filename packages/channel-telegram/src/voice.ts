import type { TelegramConfig } from "./config.ts";
import { botPost } from "./bot.ts";

export async function downloadTelegramVoice(
  parsed: TelegramConfig,
  fileId: string,
  signal: AbortSignal,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const json = (await botPost(parsed, "getFile", { file_id: fileId }, signal)) as {
    result?: { file_path?: unknown };
  };
  const filePath = json.result?.file_path;
  if (typeof filePath !== "string" || filePath.length === 0) {
    throw new Error("getFile");
  }
  const url = `https://api.telegram.org/file/bot${parsed.token}/${filePath}`;
  const res = await parsed.apiFetch(url, { signal });
  if (!res.ok) {
    throw new Error("download");
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const mimeType = filePath.endsWith(".ogg") ? "audio/ogg" : "application/octet-stream";
  return { bytes, mimeType };
}
