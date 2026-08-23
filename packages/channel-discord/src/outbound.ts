import type { DiscordConfig } from "./config.ts";
import { discordApi } from "./api.ts";

export async function sendDiscordText(
  parsed: DiscordConfig,
  channelId: string,
  text: string,
  signal: AbortSignal,
): Promise<void> {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return;
  }
  const content = trimmed.length > 2000 ? trimmed.slice(0, 2000) : trimmed;
  await discordApi(
    parsed,
    `/channels/${channelId}/messages`,
    {
      method: "POST",
      body: JSON.stringify({ content }),
    },
    signal,
  );
}
