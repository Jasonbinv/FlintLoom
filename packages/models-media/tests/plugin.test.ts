import { describe, expect, it } from "vitest";
import { Context } from "@flintloom/kernel";
import modelsPlugin, { ModelRegistry } from "@flintloom/models";
import plugin from "../src/index.ts";

describe("models-media plugin", () => {
  it("registers media kinds when apiKey is set", () => {
    const ctx = new Context();
    ctx.plugin(modelsPlugin);
    ctx.plugin(plugin, { apiKey: "sk-test", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" });
    const models = ctx.require<ModelRegistry>("models");
    expect(models.snapshot().find((r) => r.kind === "t2i")?.configured).toBe(true);
    expect(models.snapshot().find((r) => r.kind === "tts")?.configured).toBe(true);
    expect(models.snapshot().find((r) => r.kind === "asr")?.configured).toBe(true);
    expect(models.snapshot().find((r) => r.kind === "t2v")?.configured).toBe(true);
    expect(models.snapshot().find((r) => r.kind === "embedding")?.configured).toBe(true);
    expect(models.snapshot().find((r) => r.kind === "rerank")?.configured).toBe(true);
  });

  it("no apiKey leaves media kinds unconfigured", () => {
    const ctx = new Context();
    ctx.plugin(modelsPlugin);
    ctx.plugin(plugin, {});
    const models = ctx.require<ModelRegistry>("models");
    expect(models.snapshot().find((r) => r.kind === "t2i")?.configured).toBe(false);
  });
});
