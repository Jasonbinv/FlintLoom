import type { WecomConfig } from "./config.ts";
import { wecomApi } from "./api.ts";

export async function sendWecomText(
  parsed: WecomConfig,
  userId: string,
  text: string,
  signal: AbortSignal,
): Promise<void> {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return;
  }
  const outbound = trimmed.length > 2048 ? trimmed.slice(0, 2048) : trimmed;
  await wecomApi(
    parsed,
    "/message/send",
    {
      method: "POST",
      body: JSON.stringify({
        touser: userId,
        msgtype: "text",
        agentid: parsed.agentId,
        text: { content: outbound },
        safe: 0,
      }),
    },
    signal,
  );
}
