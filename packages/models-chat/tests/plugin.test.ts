import { describe, expect, it } from "vitest";
import { Context } from "@flintloom/kernel";
import modelsPlugin, { type ModelRegistry } from "@flintloom/models";
import plugin from "../src/index.ts";

describe("models-chat plugin", () => {
  it("no apiKey does not configure chat", () => {
    const ctx = new Context();
    ctx.plugin(modelsPlugin);
    ctx.plugin(plugin, {});
    expect(
      ctx.require<ModelRegistry>("models").snapshot().find((r) => r.kind === "chat")
        ?.configured,
    ).toBe(false);
  });

  it("apiKey registers default chat", () => {
    const ctx = new Context();
    ctx.plugin(modelsPlugin);
    ctx.plugin(plugin, {
      apiKey: "sk-test",
      model: "m1",
      baseUrl: "http://127.0.0.1/v1",
    });
    expect(
      ctx.require<ModelRegistry>("models").snapshot().find((r) => r.kind === "chat")
        ?.configured,
    ).toBe(true);
    expect(
      ctx.require<ModelRegistry>("models").snapshot().find((r) => r.kind === "omni")
        ?.configured,
    ).toBe(true);
  });
});
