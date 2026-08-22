import type { TelegramConfig } from "./config.ts";
import { botPost } from "./bot.ts";

export async function sendTelegramVoice(
  parsed: TelegramConfig,
  chatId: number,
  bytes: Uint8Array,
  mimeType: string,
  signal: AbortSignal,
): Promise<void> {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  const ext = mimeType.includes("ogg") ? "voice.ogg" : mimeType.includes("wav") ? "voice.wav" : "voice.bin";
  form.append("voice", new Blob([bytes], { type: mimeType }), ext);
  const res = await parsed.apiFetch(
    `https://api.telegram.org/bot${parsed.token}/sendVoice`,
    {
      method: "POST",
      body: form,
      signal,
    },
  );
  if (!res.ok) {
    throw new Error("sendVoice");
  }
  const json: unknown = await res.json();
  if (
    json === null ||
    typeof json !== "object" ||
    !("ok" in json) ||
    (json as { ok: unknown }).ok !== true
  ) {
    throw new Error("sendVoice");
  }
}
