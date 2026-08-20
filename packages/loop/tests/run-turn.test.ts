import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import a2uiPlugin from "@flintloom/a2ui";
import { createFsTool } from "@flintloom/fs";
import { Context } from "@flintloom/kernel";
import modelsPlugin, {
  type ChatProvider,
  type ModelRegistry,
} from "@flintloom/models";
import { Session } from "@flintloom/session";
import toolsPlugin, { type ToolRegistry } from "@flintloom/tools";
import loopPlugin, { runTurn, type LoopService } from "../src/index.ts";

function confirmMessages(surfaceId = "main") {
  return [
    {
      version: "v0.9" as const,
      createSurface: { surfaceId, catalogId: "flintloom:a2ui:core" },
    },
    {
      version: "v0.9" as const,
      updateComponents: {
        surfaceId,
        components: [
          { id: "root", component: "Column", children: ["title", "ok"] },
          { id: "title", component: "Text", text: "Continue?" },
          {
            id: "ok",
            component: "Button",
            child: "ok-label",
            action: { event: { name: "confirm" } },
          },
          { id: "ok-label", component: "Text", text: "OK" },
        ],
      },
    },
  ];
}

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

  it("pauses on host channel after a2ui_emit wait and continues after action", async () => {
    let streamCall = 0;
    const fakeChat: ChatProvider = {
      async *stream() {
        streamCall += 1;
        if (streamCall === 1) {
          yield {
            type: "tool_call",
            id: "c1",
            name: "a2ui_emit",
            args: { messages: confirmMessages() },
          };
        } else {
          yield { type: "text", text: "done-after-click" };
        }
      },
    };
    const ctx = boot();
    ctx.plugin(a2uiPlugin);
    ctx.require<ModelRegistry>("models").registerChat("fake", fakeChat);
    ctx.require<ModelRegistry>("models").setDefault("chat", "fake");
    const session = new Session("s-a2ui");
    const first = await runTurn({
      ctx,
      session,
      text: "show card",
      workspaceRoot: process.cwd(),
      channel: "host",
      signal: new AbortController().signal,
    });
    expect(first.status).toBe("awaiting_action");
    expect(session.events().some((e) => e.type === "turn/end")).toBe(false);
    expect(session.events().some((e) => e.type === "a2ui/surface")).toBe(true);
    const tool = session.events().find((e) => e.type === "tool/result");
    expect(tool && "text" in tool ? tool.text : "").not.toContain("Continue?");

    const { continueTurn } = await import("../src/index.ts");
    const second = await continueTurn({
      ctx,
      session,
      turnId: first.turnId,
      action: { surfaceId: "main", name: "confirm" },
      workspaceRoot: process.cwd(),
      channel: "host",
      signal: new AbortController().signal,
    });
    expect(second.status).toBe("ok");
    expect(second.turnId).toBe(first.turnId);
    expect(session.events().some((e) => e.type === "turn/end" && e.status === "ok")).toBe(true);
    expect(streamCall).toBe(2);
  });

  it("does not pause a2ui wait on cli channel", async () => {
    let n = 0;
    const fakeChat: ChatProvider = {
      async *stream() {
        n += 1;
        if (n === 1) {
          yield {
            type: "tool_call",
            id: "c1",
            name: "a2ui_emit",
            args: { messages: confirmMessages() },
          };
        } else {
          yield { type: "text", text: "cli-skip-wait" };
        }
      },
    };
    const ctx = boot();
    ctx.plugin(a2uiPlugin);
    ctx.require<ModelRegistry>("models").registerChat("fake", fakeChat);
    ctx.require<ModelRegistry>("models").setDefault("chat", "fake");
    const session = new Session("s-cli");
    const result = await runTurn({
      ctx,
      session,
      text: "emit",
      workspaceRoot: process.cwd(),
      channel: "cli",
      signal: new AbortController().signal,
    });
    expect(result.status).toBe("ok");
    expect(session.events().some((e) => e.type === "turn/end")).toBe(true);
  });

  it("does not pause a2ui wait on webhook channel", async () => {
    let n = 0;
    const fakeChat: ChatProvider = {
      async *stream() {
        n += 1;
        if (n === 1) {
          yield {
            type: "tool_call",
            id: "c1",
            name: "a2ui_emit",
            args: { messages: confirmMessages() },
          };
        } else {
          yield { type: "text", text: "webhook-skip-wait" };
        }
      },
    };
    const ctx = boot();
    ctx.plugin(a2uiPlugin);
    ctx.require<ModelRegistry>("models").registerChat("fake", fakeChat);
    ctx.require<ModelRegistry>("models").setDefault("chat", "fake");
    const session = new Session("s-webhook");
    const result = await runTurn({
      ctx,
      session,
      text: "emit",
      workspaceRoot: process.cwd(),
      channel: "webhook",
      signal: new AbortController().signal,
    });
    expect(result.status).toBe("ok");
    expect(session.events().some((e) => e.type === "turn/end")).toBe(true);
  });

  it("continueTurn throws when not waiting", async () => {
    const ctx = boot();
    ctx.plugin(a2uiPlugin);
    const session = new Session("s-no");
    session.append({ type: "turn/start", turnId: "t-x" });
    session.append({ type: "turn/end", turnId: "t-x", status: "ok" });
    const { continueTurn } = await import("../src/index.ts");
    await expect(
      continueTurn({
        ctx,
        session,
        turnId: "t-x",
        action: { surfaceId: "main", name: "confirm" },
        workspaceRoot: process.cwd(),
        channel: "host",
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/not waiting/);
  });
});
