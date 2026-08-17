import { describe, expect, it } from "vitest";
import { parseSseBuffer } from "../src/sse.ts";

describe("parseSseBuffer", () => {
  it("parses chunk then end", () => {
    const raw =
      `data: ${JSON.stringify({ type: "assistant/chunk", text: "hi" })}\n\n` +
      `data: ${JSON.stringify({ type: "end", status: "ok" })}\n\n`;
    const { events, rest } = parseSseBuffer(raw);
    expect(rest).toBe("");
    expect(events).toEqual([
      { type: "assistant/chunk", text: "hi" },
      { type: "end", status: "ok" },
    ]);
  });

  it("skips malformed data lines and keeps incomplete tail", () => {
    const raw = `data: not-json\n\ndata: {"type":"assistant/chunk","text":"a"}`;
    const { events, rest } = parseSseBuffer(raw);
    expect(events).toEqual([]);
    expect(rest.startsWith("data:")).toBe(true);
    const again = parseSseBuffer(rest + "\n\n");
    expect(again.events).toEqual([{ type: "assistant/chunk", text: "a" }]);
  });
});
