import { describe, expect, it } from "vitest";
import { Context } from "@flintloom/kernel";
import modelsPlugin from "@flintloom/models";
import toolsPlugin, { type ToolRegistry } from "@flintloom/tools";
import plugin from "../src/plugin.ts";

describe("infographic plugin", () => {
  it("registers get/patch/render and stop() unregisters them", async () => {
    const ctx = new Context();
    await ctx.plugin(modelsPlugin);
    await ctx.plugin(toolsPlugin);
    const stop = await ctx.plugin(plugin);
    const tools = ctx.require<ToolRegistry>("tools");
    const names = tools.schemas().map((s) => s.name);
    expect(names).toContain("infographic_get");
    expect(names).toContain("infographic_patch");
    expect(names).toContain("infographic_render");
    const svc = ctx.require<{ parseDocument: (raw: string) => unknown; chatSurface: (syntax: string) => unknown[] }>("infographic");
    expect(typeof svc.parseDocument).toBe("function");
    expect(typeof svc.chatSurface).toBe("function");
    stop();
    expect(tools.schemas().map((s) => s.name)).not.toContain("infographic_get");
    expect(tools.schemas().map((s) => s.name)).not.toContain("infographic_patch");
    expect(tools.schemas().map((s) => s.name)).not.toContain("infographic_render");
  });
});
