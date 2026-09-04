import { describe, expect, it } from "vitest";
import { Context } from "@flintloom/kernel";
import modelsPlugin from "@flintloom/models";
import toolsPlugin, { type ToolRegistry } from "@flintloom/tools";
import plugin from "../src/index.ts";

describe("web-search plugin", () => {
  it("registers web_search", () => {
    const ctx = new Context();
    ctx.plugin(modelsPlugin);
    ctx.plugin(toolsPlugin);
    ctx.plugin(plugin);
    const names = ctx.require<ToolRegistry>("tools").schemas().map((s) => s.name);
    expect(names).toContain("web_search");
  });
});
