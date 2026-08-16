import { describe, expect, it } from "vitest";
import { Context } from "@flintloom/kernel";
import plugin, { ModelRegistry } from "../src/index.ts";

describe("models plugin", () => {
  it("provide models 注册表", () => {
    const ctx = new Context();
    ctx.plugin(plugin);
    expect(ctx.require("models")).toBeInstanceOf(ModelRegistry);
  });
});
