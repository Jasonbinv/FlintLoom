import { describe, expect, it } from "vitest";
import { Context } from "@flintloom/kernel";
import modelsPlugin from "@flintloom/models";
import toolsPlugin, { type ToolRegistry } from "@flintloom/tools";
import plugin from "../src/index.ts";

describe("weather plugin", () => {
  it("registers get_weather", () => {
    const ctx = new Context();
    ctx.plugin(modelsPlugin);
    ctx.plugin(toolsPlugin);
    ctx.plugin(plugin);
    const names = ctx.require<ToolRegistry>("tools").schemas().map((s) => s.name);
    expect(names).toContain("get_weather");
  });
});
