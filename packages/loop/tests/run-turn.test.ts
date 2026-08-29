import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import a2uiPlugin from "@flintloom/a2ui";
import channelPlugin, { type ChannelRegistry } from "@flintloom/channel";
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

  it("records LLM timing, TTFT, usage and tool duration on turn/stats", async () => {
    const fakeChat: ChatProvider = {
      async *stream() {
        await new Promise((resolve) => setTimeout(resolve, 20));
        yield { type: "text", text: "ok" };
        await new Promise((resolve) => setTimeout(resolve, 20));
        yield {
          type: "usage",
          inputTokens: 12,
          outputTokens: 4,
          cacheReadTokens: 3,
        };
      },
    };

    const ctx = boot();
    ctx.require<ModelRegistry>("models").registerChat("fake", fakeChat);
    ctx.require<ModelRegistry>("models").setDefault("chat", "fake");

    const session = new Session("s-metrics");
    const result = await runTurn({
      ctx,
      session,
      text: "hello",
      workspaceRoot: process.cwd(),
      channel: "test",
      signal: new AbortController().signal,
    });

    expect(result.status).toBe("ok");
    const stepStats = session.events().find((e) => e.type === "step/stats");
    expect(stepStats).toMatchObject({
      type: "step/stats",
      step: 1,
      inputTokens: 12,
      outputTokens: 4,
      cacheReadTokens: 3,
    });
    if (stepStats?.type === "step/stats") {
      expect(stepStats.llmMs).toBeGreaterThanOrEqual(30);
      expect(stepStats.ttftMs).toBeGreaterThanOrEqual(15);
      expect(stepStats.decodeMs).toBeGreaterThanOrEqual(15);
    }
    const turnStats = session.events().find((e) => e.type === "turn/stats");
    expect(turnStats).toMatchObject({
      type: "turn/stats",
      steps: 1,
      toolCalls: 0,
      inputTokens: 12,
      outputTokens: 4,
      cacheReadTokens: 3,
    });
    if (turnStats?.type === "turn/stats") {
      expect(turnStats.llmMs).toBeGreaterThanOrEqual(30);
      expect(turnStats.ttftSteps).toBe(1);
    }
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

  it("does not pause a2ui wait on telegram channel", async () => {
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
          yield { type: "text", text: "telegram-skip-wait" };
        }
      },
    };
    const ctx = boot();
    ctx.plugin(a2uiPlugin);
    ctx.require<ModelRegistry>("models").registerChat("fake", fakeChat);
    ctx.require<ModelRegistry>("models").setDefault("chat", "fake");
    const session = new Session("s-telegram");
    const result = await runTurn({
      ctx,
      session,
      text: "emit",
      workspaceRoot: process.cwd(),
      channel: "telegram",
      signal: new AbortController().signal,
    });
    expect(result.status).toBe("ok");
    expect(session.events().some((e) => e.type === "turn/end")).toBe(true);
  });

  it("uses omni provider when omni kind is configured", async () => {
    let chatCalled = false;
    let omniCalled = false;
    const fakeChat: ChatProvider = {
      async *stream() {
        chatCalled = true;
        yield { type: "text", text: "from-chat" };
      },
    };
    const fakeOmni: ChatProvider = {
      async *stream() {
        omniCalled = true;
        yield { type: "text", text: "from-omni" };
      },
    };
    const ctx = boot();
    const models = ctx.require<ModelRegistry>("models");
    models.registerChat("fake", fakeChat);
    models.setDefault("chat", "fake");
    models.registerOmni("omni", fakeOmni);
    models.setDefault("omni", "omni");
    const session = new Session("s-omni");
    const result = await runTurn({
      ctx,
      session,
      text: "hello",
      workspaceRoot: process.cwd(),
      channel: "host",
      signal: new AbortController().signal,
    });
    expect(result.status).toBe("ok");
    expect(omniCalled).toBe(true);
    expect(chatCalled).toBe(false);
    expect(session.events().find((e) => e.type === "assistant/message")).toEqual({
      type: "assistant/message",
      text: "from-omni",
    });
  });

  it("logs user/message with images for multimodal turns", async () => {
    const fakeChat: ChatProvider = {
      async *stream() {
        yield { type: "text", text: "seen-image" };
      },
    };
    const ctx = boot();
    ctx.require<ModelRegistry>("models").registerChat("fake", fakeChat);
    ctx.require<ModelRegistry>("models").setDefault("chat", "fake");
    const session = new Session("s-images");
    const result = await runTurn({
      ctx,
      session,
      text: "what is this",
      images: [{ mime: "image/png", data: "abc" }],
      workspaceRoot: process.cwd(),
      channel: "host",
      signal: new AbortController().signal,
    });
    expect(result.status).toBe("ok");
    expect(session.events().find((e) => e.type === "user/message")).toEqual({
      type: "user/message",
      text: "what is this",
      images: [{ mime: "image/png", data: "abc" }],
    });
    expect(session.deriveMessages()).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "what is this" },
          { type: "image", mime: "image/png", data: "abc" },
        ],
      },
      { role: "assistant", content: "seen-image" },
    ]);
  });

  it("uses chat provider when omni is not configured", async () => {
    let chatCalled = false;
    const fakeChat: ChatProvider = {
      async *stream() {
        chatCalled = true;
        yield { type: "text", text: "from-chat" };
      },
    };
    const fakeOmni: ChatProvider = {
      async *stream() {
        yield { type: "text", text: "from-omni" };
      },
    };
    const ctx = boot();
    const models = ctx.require<ModelRegistry>("models");
    models.registerChat("fake", fakeChat);
    models.setDefault("chat", "fake");
    models.registerOmni("omni", fakeOmni);
    const session = new Session("s-chat");
    const result = await runTurn({
      ctx,
      session,
      text: "hello",
      workspaceRoot: process.cwd(),
      channel: "host",
      signal: new AbortController().signal,
    });
    expect(result.status).toBe("ok");
    expect(chatCalled).toBe(true);
    expect(session.events().find((e) => e.type === "assistant/message")).toEqual({
      type: "assistant/message",
      text: "from-chat",
    });
  });

  it("delivers when channel registry has deliver handler", async () => {
    const delivered: string[] = [];
    const fakeChat: ChatProvider = {
      async *stream() {
        yield { type: "text", text: "telegram-out" };
      },
    };
    const ctx = boot();
    ctx.plugin(channelPlugin);
    ctx.require<ChannelRegistry>("channels").register("telegram", {
      async inbound() {
        throw new Error("inbound");
      },
      async deliver(out) {
        delivered.push(out.turnId);
      },
    });
    ctx.require<ModelRegistry>("models").registerChat("fake", fakeChat);
    ctx.require<ModelRegistry>("models").setDefault("chat", "fake");
    const session = new Session("telegram:1");
    const result = await runTurn({
      ctx,
      session,
      text: "hi",
      workspaceRoot: process.cwd(),
      channel: "telegram",
      signal: new AbortController().signal,
    });
    expect(result.status).toBe("ok");
    expect(delivered.length).toBe(1);
    expect(delivered[0]).toBe(result.turnId);
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

  it("omits web_search from tools and system when webSearch is unset", async () => {
    let lastToolNames: string[] = [];
    let systemContent = "";
    const fakeChat: ChatProvider = {
      async *stream(req) {
        lastToolNames = req.tools.map((t) => t.name);
        const first = req.messages[0];
        systemContent = typeof first?.content === "string" ? first.content : "";
        yield { type: "text", text: "ok" };
      },
    };

    const ctx = boot();
    ctx.require<ModelRegistry>("models").registerChat("fake", fakeChat);
    ctx.require<ModelRegistry>("models").setDefault("chat", "fake");
    ctx.require<ToolRegistry>("tools").register({
      name: "web_search",
      description: "search",
      parameters: { type: "object", properties: {} },
      async execute(_args, exec) {
        if (exec.webSearch !== true) return "failed: web_search disabled";
        return "searched";
      },
    });

    const session = new Session("s-ws-off");
    const result = await runTurn({
      ctx,
      session,
      text: "hello",
      workspaceRoot: process.cwd(),
      channel: "test",
      signal: new AbortController().signal,
    });

    expect(result.status).toBe("ok");
    expect(lastToolNames).not.toContain("web_search");
    expect(systemContent).not.toContain("web_search");
  });

  it("includes web_search in tools, system, and turn/start when webSearch is true", async () => {
    let lastToolNames: string[] = [];
    let systemContent = "";
    const fakeChat: ChatProvider = {
      async *stream(req) {
        lastToolNames = req.tools.map((t) => t.name);
        const first = req.messages[0];
        systemContent = typeof first?.content === "string" ? first.content : "";
        yield { type: "text", text: "ok" };
      },
    };

    const ctx = boot();
    ctx.require<ModelRegistry>("models").registerChat("fake", fakeChat);
    ctx.require<ModelRegistry>("models").setDefault("chat", "fake");
    ctx.require<ToolRegistry>("tools").register({
      name: "web_search",
      description: "search",
      parameters: { type: "object", properties: {} },
      async execute(_args, exec) {
        if (exec.webSearch !== true) return "failed: web_search disabled";
        return "searched";
      },
    });

    const session = new Session("s-ws-on");
    const result = await runTurn({
      ctx,
      session,
      text: "hello",
      webSearch: true,
      workspaceRoot: process.cwd(),
      channel: "test",
      signal: new AbortController().signal,
    });

    expect(result.status).toBe("ok");
    expect(lastToolNames).toContain("web_search");
    expect(systemContent).toContain("You may call web_search");
    const turnStart = session.events().find((e) => e.type === "turn/start");
    expect(turnStart).toMatchObject({ type: "turn/start", webSearch: true });
  });

  it("rejects web_search tool_call when webSearch is false", async () => {
    let streamCall = 0;
    const fakeChat: ChatProvider = {
      async *stream() {
        streamCall += 1;
        if (streamCall === 1) {
          yield {
            type: "tool_call",
            id: "ws-1",
            name: "web_search",
            args: { query: "x" },
          };
        } else {
          yield { type: "text", text: "done" };
        }
      },
    };

    const ctx = boot();
    ctx.require<ModelRegistry>("models").registerChat("fake", fakeChat);
    ctx.require<ModelRegistry>("models").setDefault("chat", "fake");
    ctx.require<ToolRegistry>("tools").register({
      name: "web_search",
      description: "search",
      parameters: { type: "object", properties: {} },
      async execute(_args, exec) {
        if (exec.webSearch !== true) return "failed: web_search disabled";
        return "searched";
      },
    });

    const session = new Session("s-ws-deny");
    const result = await runTurn({
      ctx,
      session,
      text: "search",
      webSearch: false,
      workspaceRoot: process.cwd(),
      channel: "test",
      signal: new AbortController().signal,
    });

    expect(result.status).toBe("ok");
    const toolResult = session.events().find((e) => e.type === "tool/result");
    expect(toolResult).toMatchObject({
      type: "tool/result",
      name: "web_search",
      text: "failed: web_search disabled",
    });
  });
});
