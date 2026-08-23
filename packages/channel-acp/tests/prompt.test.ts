import { describe, expect, it } from "vitest";
import { Context } from "@flintloom/kernel";
import modelsPlugin, { type ModelRegistry } from "@flintloom/models";
import { audioBytesToBase64, promptCapabilities, promptContent } from "../src/prompt.ts";

describe("ACP prompt", () => {
  it("reports image capability when omni is configured", () => {
    const ctx = new Context();
    ctx.plugin(modelsPlugin);
    const models = ctx.require<ModelRegistry>("models");
    models.registerOmni("o", {
      stream: async function* () {
        yield { type: "text", text: "ok" };
      },
    });
    models.setDefault("omni", "o");
    expect(promptCapabilities(ctx).image).toBe(true);
  });

  it("extracts text and image blocks", async () => {
    const ctx = new Context();
    ctx.plugin(modelsPlugin);
    const models = ctx.require<ModelRegistry>("models");
    models.registerOmni("o", {
      stream: async function* () {
        yield { type: "text", text: "ok" };
      },
    });
    models.setDefault("omni", "o");
    const content = await promptContent(
      ctx,
      [
        { type: "text", text: "see this" },
        { type: "image", mimeType: "image/png", data: "abc" },
      ],
      new AbortController().signal,
    );
    expect(content).toEqual({
      text: "see this",
      images: [{ mime: "image/png", data: "abc" }],
    });
  });

  it("transcribes audio blocks when asr is configured", async () => {
    const ctx = new Context();
    ctx.plugin(modelsPlugin);
    const models = ctx.require<ModelRegistry>("models");
    models.registerAsr("a", {
      async transcribe() {
        return "spoken";
      },
    });
    models.setDefault("asr", "a");
    const data = audioBytesToBase64(Uint8Array.from([1, 2, 3]));
    const content = await promptContent(
      ctx,
      [{ type: "audio", mimeType: "audio/ogg", data }],
      new AbortController().signal,
    );
    expect(content).toEqual({ text: "spoken" });
  });

  it("reports embeddedContext when omni is configured", () => {
    const ctx = new Context();
    ctx.plugin(modelsPlugin);
    const models = ctx.require<ModelRegistry>("models");
    models.registerOmni("o", {
      stream: async function* () {
        yield { type: "text", text: "ok" };
      },
    });
    models.setDefault("omni", "o");
    expect(promptCapabilities(ctx).embeddedContext).toBe(true);
  });

  it("merges embedded_context blocks into prompt text", async () => {
    const ctx = new Context();
    ctx.plugin(modelsPlugin);
    const models = ctx.require<ModelRegistry>("models");
    models.registerOmni("o", {
      stream: async function* () {
        yield { type: "text", text: "ok" };
      },
    });
    models.setDefault("omni", "o");
    const content = await promptContent(
      ctx,
      [
        { type: "text", text: "question" },
        { type: "embedded_context", text: "file context here" },
      ],
      new AbortController().signal,
    );
    expect(content).toEqual({
      text: "question\nfile context here",
    });
  });
});
