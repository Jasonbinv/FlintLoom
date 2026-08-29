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

  it("throws GuardAskError on acp channel when guard asks", async () => {
    const ctx = new Context();
    const models = new ModelRegistry();
    models.registerGuard("g", {
      async gate() {
        return "ask";
      },
      async steward() {
        return { verdict: "ok", summary: "" };
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
    await expect(
      tools.execute(
        "touch",
        {},
        {
          workspaceRoot: "/tmp",
          signal: new AbortController().signal,
          channel: "acp",
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
      async steward() {
        return { verdict: "ok", summary: "" };
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

  it("skips guard-ask for web_search even when gate would ask", async () => {
    const ctx = new Context();
    const models = new ModelRegistry();
    let gated = 0;
    models.registerGuard("g", {
      async gate() {
        gated += 1;
        return "ask";
      },
      async steward() {
        return { verdict: "ok", summary: "" };
      },
    });
    models.setDefault("guard", "g");
    ctx.provide("models", models);
    await ctx.plugin(toolsPlugin);
    const tools = ctx.require<ToolRegistry>("tools");
    tools.register({
      name: "web_search",
      description: "search",
      parameters: { type: "object", properties: {} },
      async execute() {
        return "searched";
      },
    });
    const out = await tools.execute(
      "web_search",
      { query: "q" },
      {
        workspaceRoot: "/tmp",
        signal: new AbortController().signal,
        channel: "host",
        webSearch: true,
      },
    );
    expect(out).toBe("searched");
    expect(gated).toBe(0);
  });

  it("still asks for other tools when webSearch is true", async () => {
    const ctx = new Context();
    const models = new ModelRegistry();
    models.registerGuard("g", {
      async gate() {
        return "ask";
      },
      async steward() {
        return { verdict: "ok", summary: "" };
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
    await expect(
      tools.execute(
        "touch",
        {},
        {
          workspaceRoot: "/tmp",
          signal: new AbortController().signal,
          channel: "host",
          webSearch: true,
        },
      ),
    ).rejects.toThrow(GuardAskError);
  });
});
