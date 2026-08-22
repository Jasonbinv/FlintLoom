import { describe, expect, it, vi } from "vitest";
import { emitAcpSessionEvent } from "../src/updates.ts";

describe("emitAcpSessionEvent", () => {
  it("emits tool_call and in_progress on tool/call", () => {
    const writes: unknown[] = [];
    const write = (_method: string, params: unknown) => {
      writes.push(params);
    };
    emitAcpSessionEvent(
      "sess",
      { type: "tool/call", callId: "c1", name: "fs", args: { action: "read", path: "a" } },
      write,
    );
    expect(writes).toEqual([
      {
        sessionId: "sess",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "c1",
          title: "fs",
          kind: "read",
          status: "pending",
          rawInput: { action: "read", path: "a" },
        },
      },
      {
        sessionId: "sess",
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "c1",
          status: "in_progress",
        },
      },
    ]);
  });

  it("emits completed tool_call_update on tool/result", () => {
    const write = vi.fn();
    emitAcpSessionEvent(
      "sess",
      { type: "tool/result", callId: "c1", name: "fs", text: "file contents" },
      write,
    );
    expect(write).toHaveBeenCalledWith("session/update", {
      sessionId: "sess",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "c1",
        status: "completed",
        content: [
          {
            type: "content",
            content: { type: "text", text: "file contents" },
          },
        ],
      },
    });
  });
});
