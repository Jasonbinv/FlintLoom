import type { TelegramConfig } from "./config.ts";
import { botPost } from "./bot.ts";

function mimeFromPath(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".gif")) {
    return "image/gif";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  return "application/octet-stream";
}

export async function downloadTelegramFile(
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
  const mimeType = filePath.endsWith(".ogg")
    ? "audio/ogg"
    : mimeFromPath(filePath);
  return { bytes, mimeType };
}
