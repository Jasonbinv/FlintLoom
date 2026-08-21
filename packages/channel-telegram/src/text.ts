import type { SessionEvent } from "@flintloom/session";

export function lastAssistantText(events: readonly SessionEvent[], turnId: string): string {
  let start = -1;
  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;
    if (event.type === "turn/start" && event.turnId === turnId) {
      start = i;
    }
  }
  if (start < 0) {
    return "";
  }
  let text = "";
  for (let i = start + 1; i < events.length; i++) {
    const event = events[i]!;
    if (event.type === "turn/start") {
      break;
    }
    if (event.type === "assistant/message") {
      text = event.text;
    }
  }
  return text;
}
