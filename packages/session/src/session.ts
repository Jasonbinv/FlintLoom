import type { ChatContentPart, ChatMessage, SessionEvent, UserImage } from "./events.ts";

export function userMessageContent(text: string, images?: UserImage[]): string | ChatContentPart[] {
  if (images === undefined || images.length === 0) {
    return text;
  }
  const parts: ChatContentPart[] = [];
  if (text.length > 0) {
    parts.push({ type: "text", text });
  }
  for (const image of images) {
    parts.push({ type: "image", mime: image.mime, data: image.data });
  }
  return parts;
}

export class Session {
  readonly #events: SessionEvent[] = [];

  constructor(readonly id: string) {}

  append(event: SessionEvent): void {
    this.#events.push(event);
  }

  events(): readonly SessionEvent[] {
    return [...this.#events];
  }

  isWaiting(turnId: string): boolean {
    if (this.#isA2uiWaiting(turnId)) {
      return true;
    }
    return this.#isGuardWaiting(turnId);
  }

  #isA2uiWaiting(turnId: string): boolean {
    let started = false;
    let ended = false;
    let lastSurfaceWait: boolean | undefined;
    let actionAfterLastSurface = false;

    for (const event of this.#events) {
      if (event.type === "turn/start" && event.turnId === turnId) {
        started = true;
        ended = false;
        lastSurfaceWait = undefined;
        actionAfterLastSurface = false;
      } else if (event.type === "turn/end" && event.turnId === turnId) {
        if (started) {
          ended = true;
        }
      } else if (started && !ended && "turnId" in event && event.turnId === turnId) {
        if (event.type === "a2ui/surface") {
          lastSurfaceWait = event.wait;
          actionAfterLastSurface = false;
        } else if (event.type === "a2ui/action") {
          actionAfterLastSurface = true;
        }
      }
    }

    if (!started || ended) {
      return false;
    }
    if (lastSurfaceWait !== true || actionAfterLastSurface) {
      return false;
    }
    return true;
  }

  #isGuardWaiting(turnId: string): boolean {
    let started = false;
    let ended = false;
    const pending = new Map<string, string>();

    for (const event of this.#events) {
      if (event.type === "turn/start" && event.turnId === turnId) {
        started = true;
        ended = false;
        pending.clear();
      } else if (event.type === "turn/end" && event.turnId === turnId) {
        if (started) {
          ended = true;
        }
      } else if (started && !ended && "turnId" in event && event.turnId === turnId) {
        if (event.type === "guard/ask") {
          pending.set(event.callId, event.tool);
        } else if (event.type === "guard/response") {
          pending.delete(event.callId);
        }
      }
    }

    if (!started || ended) {
      return false;
    }
    return pending.size > 0;
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
          messages.push({
            role: "user",
            content: userMessageContent(event.text, event.images),
          });
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
        case "a2ui/surface":
          break;
        case "a2ui/action":
          flushCalls();
          messages.push({
            role: "user",
            content: JSON.stringify({
              type: "a2ui/action",
              surfaceId: event.surfaceId,
              name: event.name,
              ...(event.context !== undefined ? { context: event.context } : {}),
              ...(event.data !== undefined ? { data: event.data } : {}),
            }),
          });
          break;
      }
    }

    flushCalls();
    return messages;
  }
}
