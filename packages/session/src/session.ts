import type { ChatMessage, SessionEvent } from "./events.ts";

export class Session {
  readonly #events: SessionEvent[] = [];

  constructor(readonly id: string) {}

  append(event: SessionEvent): void {
    this.#events.push(event);
  }

  events(): readonly SessionEvent[] {
    return [...this.#events];
  }

  deriveMessages(): ChatMessage[] {
    const messages: ChatMessage[] = [];

    for (const event of this.#events) {
      switch (event.type) {
        case "user/message":
          messages.push({ role: "user", content: event.text });
          break;
        case "assistant/message":
          messages.push({ role: "assistant", content: event.text });
          break;
        case "tool/result":
          messages.push({
            role: "tool",
            content: event.text,
            toolCallId: event.callId,
            name: event.name,
          });
          break;
      }
    }

    return messages;
  }
}
