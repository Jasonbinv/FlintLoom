import { describe, expect, it } from "vitest";
import { Context } from "@flintloom/kernel";
import {
  ModelKindMissingError,
  ModelRegistry,
  type ChatProvider,
} from "../src/index.ts";

function stubChat(): ChatProvider {
  return {
    async *stream() {
      yield { type: "text", text: "ok" };
    },
  };
}

describe("ModelRegistry", () => {
  it("登记 chat 后 resolveChat() 返回同一对象", () => {
    const registry = new ModelRegistry();
    const provider = stubChat();
    registry.registerChat("default-chat", provider);
    registry.setDefault("chat", "default-chat");

    expect(registry.resolveChat()).toBe(provider);
  });

  it("未登记 chat 时 resolveChat() 抛 ModelKindMissingError 且 kind === chat", () => {
    const registry = new ModelRegistry();

    expect(() => registry.resolveChat()).toThrow(ModelKindMissingError);
    try {
      registry.resolveChat();
    } catch (err) {
      expect(err).toBeInstanceOf(ModelKindMissingError);
      expect((err as ModelKindMissingError).kind).toBe("chat");
    }
  });

  it("snapshot() 里 asr.configured === false 且解析 asr 不能得到 chat", () => {
    const registry = new ModelRegistry();
    const provider = stubChat();
    registry.registerChat("only-chat", provider);

    const asr = registry.snapshot().find((row) => row.kind === "asr");
    expect(asr?.configured).toBe(false);
    expect(asr?.defaultId).toBeNull();
    expect(registry.snapshot().find((row) => row.kind === "chat")?.configured).toBe(
      false,
    );
    expect(() => registry.resolveChat()).toThrow(ModelKindMissingError);

    const ctx = new Context();
    ctx.provide("models", registry);
    expect(() => ctx.get<ModelRegistry>("models")?.resolveChat()).toThrow(
      ModelKindMissingError,
    );
  });

  it("resolveAsr throws ModelKindMissingError when asr not configured", () => {
    const registry = new ModelRegistry();
    expect(() => registry.resolveAsr()).toThrow(ModelKindMissingError);
    try {
      registry.resolveAsr();
    } catch (err) {
      expect((err as ModelKindMissingError).kind).toBe("asr");
    }
  });
});
