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

  it("deriveMessages 在 tool/call 后插入带 toolCalls 的 assistant，再跟 tool/result", () => {
    const session = new Session("s3");
    session.append({ type: "user/message", text: "read it" });
    session.append({
      type: "tool/call",
      callId: "call-a",
      name: "fs",
      args: { action: "read", path: "a.txt" },
    });
    session.append({
      type: "tool/result",
      callId: "call-a",
      name: "fs",
      text: "file-a",
    });

    expect(session.deriveMessages()).toEqual([
      { role: "user", content: "read it" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "call-a", name: "fs", args: { action: "read", path: "a.txt" } },
        ],
      },
      {
        role: "tool",
        content: "file-a",
        toolCallId: "call-a",
        name: "fs",
      },
    ]);
  });

  it("deriveMessages 将连续 tool/call 合成一条 assistant，再按序跟 tool/result", () => {
    const session = new Session("s4");
    session.append({
      type: "tool/call",
      callId: "call-a",
      name: "fs",
      args: { path: "a.txt" },
    });
    session.append({
      type: "tool/call",
      callId: "call-b",
      name: "grep",
      args: { pattern: "x" },
    });
    session.append({
      type: "tool/result",
      callId: "call-a",
      name: "fs",
      text: "a",
    });
    session.append({
      type: "tool/result",
      callId: "call-b",
      name: "grep",
      text: "b",
    });

    expect(session.deriveMessages()).toEqual([
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "call-a", name: "fs", args: { path: "a.txt" } },
          { id: "call-b", name: "grep", args: { pattern: "x" } },
        ],
      },
      { role: "tool", content: "a", toolCallId: "call-a", name: "fs" },
      { role: "tool", content: "b", toolCallId: "call-b", name: "grep" },
    ]);
  });

  it("deriveMessages 对交错的 call/result 各自发出 assistant 再跟 tool", () => {
    const session = new Session("s5");
    session.append({
      type: "tool/call",
      callId: "call-a",
      name: "fs",
      args: { path: "a.txt" },
    });
    session.append({
      type: "tool/result",
      callId: "call-a",
      name: "fs",
      text: "a",
    });
    session.append({
      type: "tool/call",
      callId: "call-b",
      name: "grep",
      args: { pattern: "x" },
    });
    session.append({
      type: "tool/result",
      callId: "call-b",
      name: "grep",
      text: "b",
    });

    expect(session.deriveMessages()).toEqual([
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "call-a", name: "fs", args: { path: "a.txt" } }],
      },
      { role: "tool", content: "a", toolCallId: "call-a", name: "fs" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "call-b", name: "grep", args: { pattern: "x" } }],
      },
      { role: "tool", content: "b", toolCallId: "call-b", name: "grep" },
    ]);
  });

  it("isWaiting and deriveMessages for a2ui action", () => {
    const session = new Session("s-a2ui");
    session.append({ type: "turn/start", turnId: "t1" });
    session.append({
      type: "a2ui/surface",
      turnId: "t1",
      surfaceId: "main",
      wait: true,
      messages: [{ version: "v0.9", createSurface: { surfaceId: "main", catalogId: "flintloom:a2ui:core" } }],
    });
    expect(session.isWaiting("t1")).toBe(true);
    expect(session.deriveMessages()).toEqual([]);
    session.append({
      type: "a2ui/action",
      turnId: "t1",
      surfaceId: "main",
      name: "confirm",
    });
    expect(session.isWaiting("t1")).toBe(false);
    expect(session.deriveMessages()).toEqual([
      {
        role: "user",
        content: JSON.stringify({
          type: "a2ui/action",
          surfaceId: "main",
          name: "confirm",
        }),
      },
    ]);
    session.append({ type: "turn/end", turnId: "t1", status: "ok" });
    expect(session.isWaiting("t1")).toBe(false);
  });

  it("isWaiting for guard ask until guard response", () => {
    const session = new Session("s-guard");
    session.append({ type: "turn/start", turnId: "t1" });
    session.append({ type: "tool/call", callId: "c1", name: "shell", args: {} });
    session.append({
      type: "guard/ask",
      turnId: "t1",
      callId: "c1",
      tool: "shell",
      remainingCalls: [],
    });
    expect(session.isWaiting("t1")).toBe(true);
    session.append({
      type: "guard/response",
      turnId: "t1",
      callId: "c1",
      decision: "allow",
    });
    expect(session.isWaiting("t1")).toBe(false);
  });
});
