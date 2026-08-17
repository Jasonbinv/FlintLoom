import { describe, expect, it } from "vitest";
import { Context } from "@flintloom/kernel";
import modelsPlugin from "@flintloom/models";
import toolsPlugin, { type ToolRegistry } from "@flintloom/tools";
import plugin from "../src/index.ts";

describe("infographic plugin", () => {
  it("registers get/patch and stop() unregisters them", () => {
    const ctx = new Context();
    ctx.plugin(modelsPlugin);
    ctx.plugin(toolsPlugin);
    const stop = ctx.plugin(plugin);
    const tools = ctx.require<ToolRegistry>("tools");
    const names = tools.schemas().map((s) => s.name);
    expect(names).toContain("infographic_get");
    expect(names).toContain("infographic_patch");
    const svc = ctx.require<{ parseDocument: (raw: string) => unknown }>("infographic");
    expect(typeof svc.parseDocument).toBe("function");
    stop();
    expect(tools.schemas().map((s) => s.name)).not.toContain("infographic_get");
    expect(tools.schemas().map((s) => s.name)).not.toContain("infographic_patch");
  });
});
