import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFsTool } from "@flintloom/fs";
import { Context } from "@flintloom/kernel";
import modelsPlugin, {
  type ChatProvider,
  type ModelRegistry,
} from "@flintloom/models";
import { Session } from "@flintloom/session";
import toolsPlugin, { type ToolRegistry } from "@flintloom/tools";
import loopPlugin, { runTurn, type LoopService } from "../src/index.ts";

function boot() {
  const ctx = new Context();
  ctx.plugin(modelsPlugin);
  ctx.plugin(toolsPlugin);
  ctx.plugin(loopPlugin);
  return ctx;
}

describe("runTurn", () => {
  it("loop plugin provides runTurn", async () => {
    const ctx = boot();
    const loop = ctx.require<LoopService>("loop");
    expect(typeof loop.runTurn).toBe("function");
  });

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

    const ctx = boot();
    ctx.require<ModelRegistry>("models").registerChat("fake", fakeChat);
    ctx.require<ModelRegistry>("models").setDefault("chat", "fake");
    ctx.require<ToolRegistry>("tools").register(createFsTool());

    const workspace = mkdtempSync(join(tmpdir(), "flintloom-loop-"));
    writeFileSync(join(workspace, "README.md"), "title-one");

    const session = new Session("s1");

    const result = await runTurn({
      ctx,
      session,
      text: "read the readme",
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

  it("fails and ends turn when chat stream throws", async () => {
    const fakeChat: ChatProvider = {
      async *stream() {
        throw new Error("network down");
      },
    };

    const ctx = boot();
    ctx.require<ModelRegistry>("models").registerChat("fake", fakeChat);
    ctx.require<ModelRegistry>("models").setDefault("chat", "fake");

    const session = new Session("s3");

    const result = await runTurn({
      ctx,
      session,
      text: "hello",
      workspaceRoot: process.cwd(),
      channel: "test",
      signal: new AbortController().signal,
    });

    expect(result.status).toBe("failed");

    const turnEnd = session.events().find((e) => e.type === "turn/end");
    expect(turnEnd).toMatchObject({ status: "failed" });

    const modelError = session.events().find((e) => e.type === "model/error");
    expect(modelError).toMatchObject({ kind: "chat", message: "network down" });
  });

  it("fails when chat model is missing", async () => {
    const ctx = boot();
    const session = new Session("s2");

    const result = await runTurn({
      ctx,
      session,
      text: "hello",
      workspaceRoot: process.cwd(),
      channel: "test",
      signal: new AbortController().signal,
    });

    expect(result.status).toBe("failed");

    const modelError = session.events().find((e) => e.type === "model/error");
    expect(modelError).toMatchObject({ kind: "chat" });
  });
});
