import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFsTool } from "@flintloom/fs";
import { ModelRegistry, type ChatProvider } from "@flintloom/models";
import { Session, type SessionEvent } from "@flintloom/session";
import { ToolRegistry } from "@flintloom/tools";
import { runTurn } from "../src/index.ts";

describe("runTurn", () => {
  it("runs fs tool then completes with assistant message", async () => {
    let streamCall = 0;
    const fakeChat: ChatProvider = {
      async *stream() {
        streamCall += 1;
        if (streamCall === 1) {
          yield {
            type: "tool_call",
            id: "call-1",
            name: "fs",
            args: { action: "read", path: "README.md" },
          };
        } else {
          yield { type: "text", text: "summary-ok" };
        }
      },
    };

    const models = new ModelRegistry();
    models.registerChat("fake", fakeChat);
    models.setDefault("chat", "fake");

    const tools = new ToolRegistry();
    tools.register(createFsTool());

    const workspace = mkdtempSync(join(tmpdir(), "flintloom-loop-"));
    writeFileSync(join(workspace, "README.md"), "title-one");

    const session = new Session("s1");

    const result = await runTurn({
      session,
      text: "read the readme",
      models,
      tools,
      workspaceRoot: workspace,
      channel: "test",
      signal: new AbortController().signal,
    });

    expect(result.status).toBe("ok");
    expect(streamCall).toBe(2);

    const messages = session.deriveMessages();
    const toolMsg = messages.find((m) => m.role === "tool");
    expect(toolMsg?.content).toContain("title-one");

    const assistantEvent = session.events().find(
      (e) => e.type === "assistant/message",
    );
    expect(assistantEvent).toEqual({
      type: "assistant/message",
      text: "summary-ok",
    });
  });

  it("fails when chat model is missing", async () => {
    const models = new ModelRegistry();
    const tools = new ToolRegistry();
    const session = new Session("s2");

    const result = await runTurn({
      session,
      text: "hello",
      models,
      tools,
      workspaceRoot: process.cwd(),
      channel: "test",
      signal: new AbortController().signal,
    });

    expect(result.status).toBe("failed");

    const modelError = session.events().find((e) => e.type === "model/error");
    expect(modelError).toMatchObject({ kind: "chat" });
  });
});
