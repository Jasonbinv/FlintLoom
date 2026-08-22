import { describe, expect, it, vi } from "vitest";
import { Context } from "@flintloom/kernel";
import { ModelRegistry, type GuardProvider } from "@flintloom/models";
import { Session } from "@flintloom/session";
import toolsPlugin, { ToolRegistry } from "@flintloom/tools";
import { continueGuardTurn, runTurn } from "../src/run-turn.ts";

describe("guard ask in runTurn", () => {
  it("pauses on host ask and continues on allow", async () => {
    const ctx = new Context();
    const models = new ModelRegistry();
    let gateCalls = 0;
    const guard: GuardProvider = {
      async gate(_input, signal) {
        if (signal.aborted) {
          return "deny";
        }
        gateCalls += 1;
        return gateCalls === 1 ? "ask" : "allow";
      },
      async steward() {
        return { verdict: "ok", summary: "" };
      },
    };
    models.registerGuard("g", guard);
    models.setDefault("guard", "g");
    ctx.provide("models", models);
    await ctx.plugin(toolsPlugin);
    const tools = ctx.require<ToolRegistry>("tools");
    tools.register({
      name: "touch",
      description: "touch",
      parameters: { type: "object", properties: {} },
      async execute() {
        return "done";
      },
    });

    let streamCalls = 0;
    const chat = {
      stream: vi.fn(async function* () {
        streamCalls += 1;
        if (streamCalls === 1) {
          yield {
            type: "tool_call" as const,
            id: "call-1",
            name: "touch",
            args: {},
          };
        } else {
          yield { type: "text" as const, text: "all done" };
        }
      }),
    };
    models.registerChat("fake", chat);
    models.setDefault("chat", "fake");

    const session = new Session("s1");
    const first = await runTurn({
      ctx,
      session,
      text: "go",
      workspaceRoot: "/tmp",
      channel: "host",
      signal: new AbortController().signal,
    });
    expect(first.status).toBe("awaiting_action");
    expect(session.events().some((e) => e.type === "guard/ask")).toBe(true);

    const second = await continueGuardTurn({
      ctx,
      session,
      turnId: first.turnId,
      callId: "call-1",
      decision: "allow",
      workspaceRoot: "/tmp",
      channel: "host",
      signal: new AbortController().signal,
    });
    expect(second.status).toBe("ok");
    expect(
      session.events().find((e) => e.type === "tool/result" && e.callId === "call-1"),
    ).toMatchObject({ text: "done" });
  });
});
