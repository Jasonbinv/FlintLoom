import type { FeishuConfig } from "./config.ts";
import { feishuApi } from "./api.ts";

export async function sendFeishuText(
  parsed: FeishuConfig,
  chatId: string,
  text: string,
  signal: AbortSignal,
): Promise<void> {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return;
  }
  const outbound = trimmed.length > 4000 ? trimmed.slice(0, 4000) : trimmed;
  await feishuApi(
    parsed,
    "/im/v1/messages?receive_id_type=chat_id",
    {
      method: "POST",
      body: JSON.stringify({
        receive_id: chatId,
        msg_type: "text",
        content: JSON.stringify({ text: outbound }),
      }),
    },
    signal,
  );
}
