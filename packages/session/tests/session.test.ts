import { describe, expect, it } from "vitest";
import type { SessionEvent } from "../src/events.ts";
import { Session } from "../src/index.ts";

describe("Session", () => {
  it("deriveMessages 忽略 assistant/chunk，events 仍保留", () => {
    const session = new Session("s1");
    session.append({ type: "user/message", text: "hello" });
    session.append({ type: "assistant/chunk", text: "partial" });
    session.append({ type: "assistant/message", text: "full reply" });

    expect(session.deriveMessages()).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "full reply" },
    ]);

    expect(session.events()).toHaveLength(3);
    expect(session.events()[1]).toEqual({
      type: "assistant/chunk",
      text: "partial",
    });
  });

  it("events() 返回副本，外部 mutate 不影响后续 events() 与 deriveMessages", () => {
    const session = new Session("s2");
    session.append({ type: "user/message", text: "hello" });
    session.append({ type: "assistant/message", text: "reply" });

    const snapshot = session.events();
    (snapshot as SessionEvent[]).pop();
    (snapshot as SessionEvent[]).push({
      type: "user/message",
      text: "injected",
    });

    expect(session.events()).toHaveLength(2);
    expect(session.events()).toEqual([
      { type: "user/message", text: "hello" },
      { type: "assistant/message", text: "reply" },
    ]);
    expect(session.deriveMessages()).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "reply" },
    ]);
  });
});
