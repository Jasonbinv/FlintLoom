import { describe, expect, it } from "vitest";
import type { SessionEvent } from "@flintloom/session";
import { lastAssistantText } from "../src/text.ts";

describe("lastAssistantText", () => {
  it("returns the last assistant/message of the matching turn only", () => {
    const events: SessionEvent[] = [
      { type: "turn/start", turnId: "t0" },
      { type: "assistant/message", text: "old" },
      { type: "turn/end", turnId: "t0", status: "ok" },
      { type: "turn/start", turnId: "t1" },
      { type: "user/message", text: "hi" },
      { type: "assistant/chunk", text: "x" },
      { type: "assistant/message", text: "first" },
      { type: "assistant/message", text: "second" },
      { type: "model/error", kind: "chat", message: "nope" },
    ];
    expect(lastAssistantText(events, "t1")).toBe("second");
    expect(lastAssistantText(events, "t0")).toBe("old");
    expect(lastAssistantText(events, "missing")).toBe("");
  });
});
