import { describe, expect, it } from "vitest";
import { Context } from "@flintloom/kernel";
import modelsPlugin from "@flintloom/models";
import toolsPlugin, { type ToolRegistry } from "@flintloom/tools";
import plugin from "../src/index.ts";
import type { A2uiService } from "../src/types.ts";

describe("a2ui plugin", () => {
  it("registers a2ui_emit and stop() unregisters it", () => {
    const ctx = new Context();
    ctx.plugin(modelsPlugin);
    ctx.plugin(toolsPlugin);
    const stop = ctx.plugin(plugin);
    const tools = ctx.require<ToolRegistry>("tools");
    expect(tools.schemas().map((s) => s.name)).toContain("a2ui_emit");
    ctx.require<A2uiService>("a2ui");
    stop();
    expect(tools.schemas().map((s) => s.name)).not.toContain("a2ui_emit");
  });
});
