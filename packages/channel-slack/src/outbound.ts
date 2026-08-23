import type { SlackConfig } from "./config.ts";
import { slackApi } from "./api.ts";

export async function sendSlackText(
  parsed: SlackConfig,
  channelId: string,
  text: string,
  signal: AbortSignal,
): Promise<void> {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return;
  }
  const outbound = trimmed.length > 4000 ? trimmed.slice(0, 4000) : trimmed;
  await slackApi(
    parsed,
    "chat.postMessage",
    {
      method: "POST",
      body: JSON.stringify({ channel: channelId, text: outbound }),
    },
    signal,
  );
}
