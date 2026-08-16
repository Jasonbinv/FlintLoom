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
    let pendingCalls: { id: string; name: string; args: unknown }[] = [];

    const flushCalls = (): void => {
      if (pendingCalls.length === 0) {
        return;
      }
      messages.push({
        role: "assistant",
        content: "",
        toolCalls: pendingCalls,
      });
      pendingCalls = [];
    };

    for (const event of this.#events) {
      switch (event.type) {
        case "user/message":
          flushCalls();
          messages.push({ role: "user", content: event.text });
          break;
        case "assistant/message":
          flushCalls();
          messages.push({ role: "assistant", content: event.text });
          break;
        case "tool/call":
          pendingCalls.push({
            id: event.callId,
            name: event.name,
            args: event.args,
          });
          break;
        case "tool/result":
          flushCalls();
          messages.push({
            role: "tool",
            content: event.text,
            toolCallId: event.callId,
            name: event.name,
          });
          break;
      }
    }

    flushCalls();
    return messages;
  }
}
