import { describe, expect, it } from "vitest";
import { Context } from "@flintloom/kernel";
import { ModelRegistry, type GuardProvider } from "@flintloom/models";
import toolsPlugin, { GuardAskError, ToolRegistry } from "@flintloom/tools";

describe("guard ask in tools plugin", () => {
  it("throws GuardAskError on host channel when guard asks", async () => {
    const ctx = new Context();
    const models = new ModelRegistry();
    const guard: GuardProvider = {
      async gate() {
        return "ask";
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
        return "ok";
      },
    });
    await expect(
      tools.execute(
        "touch",
        {},
        {
          workspaceRoot: "/tmp",
          signal: new AbortController().signal,
          channel: "host",
        },
      ),
    ).rejects.toThrow(GuardAskError);
  });

  it("denies ask on cli channel", async () => {
    const ctx = new Context();
    const models = new ModelRegistry();
    models.registerGuard("g", {
      async gate() {
        return "ask";
      },
    });
    models.setDefault("guard", "g");
    ctx.provide("models", models);
    await ctx.plugin(toolsPlugin);
    const tools = ctx.require<ToolRegistry>("tools");
    tools.register({
      name: "touch",
      description: "touch",
      parameters: { type: "object", properties: {} },
      async execute() {
        return "ok";
      },
    });
    const out = await tools.execute(
      "touch",
      {},
      {
        workspaceRoot: "/tmp",
        signal: new AbortController().signal,
        channel: "cli",
      },
    );
    expect(out).toBe("guard denied: touch");
  });
});
