import { generationDirFromTopic } from "@flintloom/tools";
import type { Session } from "@flintloom/session";

export function generationDirOf(session: Session): string {
  let topic = "chat";
  let startedAt = Date.now();
  for (const event of session.events()) {
    if (event.type === "user/message") {
      const firstLine = event.text.split(/\r?\n/, 1)[0]?.trim() ?? "";
      if (firstLine.length > 0) {
        topic = firstLine;
        break;
      }
    }
  }
  for (const event of session.events()) {
    if (event.type === "turn/start") {
      startedAt = event.startedAt;
      break;
    }
  }
  return generationDirFromTopic(topic, startedAt);
}
