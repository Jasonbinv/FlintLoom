import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Context } from "@flintloom/kernel";
import modelsPlugin from "@flintloom/models";
import toolsPlugin, { type ToolRegistry } from "@flintloom/tools";
import plugin from "../src/index.ts";

describe("skill plugin", () => {
  it("registers skill and dispose removes it", async () => {
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-skill-plug-"));
    const ctx = new Context();
    await ctx.plugin(modelsPlugin);
    await ctx.plugin(toolsPlugin);
    const stop = await ctx.plugin(plugin, { homeDir });
    const tools = ctx.require<ToolRegistry>("tools");
    expect(tools.schemas().map((s) => s.name)).toContain("skill");
    stop();
    expect(tools.schemas().map((s) => s.name)).not.toContain("skill");
    await expect(
      tools.execute("skill", { action: "list" }, {
        workspaceRoot: homeDir,
        signal: new AbortController().signal,
        channel: "cli",
      }),
    ).rejects.toThrow(/not registered/);
  });
});
