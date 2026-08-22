import { describe, expect, it } from "vitest";
import { Context } from "@flintloom/kernel";
import modelsPlugin, { type ModelRegistry } from "@flintloom/models";
import plugin from "../src/index.ts";

describe("@flintloom/models-guard plugin", () => {
  it("registers guard when apiKey is set", async () => {
    const ctx = new Context();
    ctx.plugin(modelsPlugin);
    await ctx.plugin(plugin, { apiKey: "k", baseUrl: "http://127.0.0.1:9" });
    const models = ctx.require<ModelRegistry>("models");
    expect(models.snapshot().some((row) => row.kind === "guard" && row.configured)).toBe(
      true,
    );
    expect(models.resolveGuard()).toBeDefined();
  });

  it("skips registration without apiKey", async () => {
    const ctx = new Context();
    ctx.plugin(modelsPlugin);
    await ctx.plugin(plugin, {});
    const models = ctx.require<ModelRegistry>("models");
    expect(models.resolveGuard()).toBeUndefined();
  });
});
