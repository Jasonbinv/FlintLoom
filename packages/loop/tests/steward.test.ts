import { describe, expect, it } from "vitest";
import { Context } from "@flintloom/kernel";
import modelsPlugin, { type GuardProvider, type ModelRegistry } from "@flintloom/models";
import { Session } from "@flintloom/session";
import toolsPlugin, { ToolRegistry } from "@flintloom/tools";
import loopPlugin, { runTurn } from "../src/index.ts";

function boot(ctx: Context) {
  ctx.plugin(modelsPlugin);
  ctx.plugin(toolsPlugin);
  ctx.plugin(loopPlugin);
}

describe("guard steward", () => {
  it("appends guard/steward before tool/result when configured", async () => {
    const ctx = new Context();
    boot(ctx);
    const models = ctx.require<ModelRegistry>("models");
    const guard: GuardProvider = {
      async gate() {
        return "allow";
      },
      async steward() {
        return { verdict: "suspicious", summary: "looks odd" };
      },
    };
    models.registerGuard("g", guard);
    models.setDefault("guard", "g");
    let streamStep = 0;
    models.registerChat("fake", {
      async *stream() {
        if (streamStep++ === 0) {
          yield {
            type: "tool_call",
            id: "c1",
            name: "touch",
            args: {},
          };
        } else {
          yield { type: "text", text: "done" };
        }
      },
    });
    models.setDefault("chat", "fake");
    const tools = ctx.require<ToolRegistry>("tools");
    tools.register({
      name: "touch",
      description: "touch",
      parameters: { type: "object", properties: {} },
      async execute() {
        return "tool-output";
      },
    });

    const session = new Session("s1");
    const result = await runTurn({
      ctx,
      session,
      text: "go",
      workspaceRoot: process.cwd(),
      channel: "host",
      signal: new AbortController().signal,
    });
    expect(result.status).toBe("ok");
    const events = session.events();
    const stewardIdx = events.findIndex((e) => e.type === "guard/steward");
    const resultIdx = events.findIndex((e) => e.type === "tool/result");
    expect(stewardIdx).toBeGreaterThanOrEqual(0);
    expect(resultIdx).toBeGreaterThan(stewardIdx);
    expect(events[stewardIdx]).toMatchObject({
      type: "guard/steward",
      verdict: "suspicious",
      summary: "looks odd",
    });
  });

  it("skips steward for guard denied tool results", async () => {
    const ctx = new Context();
    boot(ctx);
    const models = ctx.require<ModelRegistry>("models");
    let stewardCalls = 0;
    models.registerGuard("g", {
      async gate() {
        return "deny";
      },
      async steward() {
        stewardCalls += 1;
        return { verdict: "ok", summary: "" };
      },
    });
    models.setDefault("guard", "g");
    models.registerChat("fake", {
      async *stream() {
        yield {
          type: "tool_call",
          id: "c1",
          name: "touch",
          args: {},
        };
      },
    });
    models.setDefault("chat", "fake");
    const tools = ctx.require<ToolRegistry>("tools");
    tools.register({
      name: "touch",
      description: "touch",
      parameters: { type: "object", properties: {} },
      async execute() {
        return "never";
      },
    });

    const session = new Session("s2");
    await runTurn({
      ctx,
      session,
      text: "go",
      workspaceRoot: process.cwd(),
      channel: "host",
      signal: new AbortController().signal,
    });
    expect(stewardCalls).toBe(0);
    expect(session.events().some((e) => e.type === "guard/steward")).toBe(false);
  });
});
