import { describe, expect, it } from "vitest";
import { Context } from "@flintloom/kernel";
import modelsPlugin from "@flintloom/models";
import toolsPlugin, { type ToolRegistry } from "@flintloom/tools";
import plugin from "../src/index.ts";

describe("fs plugin", () => {
  it("registers fs tool", () => {
    const ctx = new Context();
    ctx.plugin(modelsPlugin);
    ctx.plugin(toolsPlugin);
    ctx.plugin(plugin);
    const names = ctx.require<ToolRegistry>("tools").schemas().map((s) => s.name);
    expect(names).toContain("fs");
  });

  it("stop() unregisters fs from tools", async () => {
    const ctx = new Context();
    ctx.plugin(modelsPlugin);
    ctx.plugin(toolsPlugin);
    const stop = await ctx.plugin(plugin);
    const tools = ctx.require<ToolRegistry>("tools");
    stop();
    expect(tools.schemas().map((s) => s.name)).not.toContain("fs");
    await expect(
      tools.execute(
        "fs",
        { action: "list", path: "." },
        {
          workspaceRoot: process.cwd(),
          signal: new AbortController().signal,
          channel: "test",
        },
      ),
    ).rejects.toThrow(/fs/);
  });
});
