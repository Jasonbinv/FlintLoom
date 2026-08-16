import { describe, expect, it } from "vitest";
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
});
