import { describe, expect, it } from "vitest";
import { Context } from "@flintloom/kernel";
import modelsPlugin, { type ModelRegistry } from "@flintloom/models";
import { telegramInboundContent } from "../src/inbound-content.ts";
import { parseTelegramConfig } from "../src/config.ts";

describe("telegramInboundContent", () => {
  it("returns trimmed text for plain messages", async () => {
    const ctx = new Context();
    ctx.plugin(modelsPlugin);
    const parsed = parseTelegramConfig({
      token: "tok",
      allowedChatIds: [1],
      poll: false,
      apiFetch: async () => new Response("{}", { status: 200 }),
    });
    const signal = new AbortController().signal;
    expect(
      await telegramInboundContent(
        ctx,
        parsed,
        { text: "  hi  " },
        signal,
      ),
    ).toEqual({ text: "hi" });
  });

  it("downloads photo when omni is configured", async () => {
    const ctx = new Context();
    ctx.plugin(modelsPlugin);
    const models = ctx.require<ModelRegistry>("models");
    models.registerOmni("o", {
      stream: async function* () {
        yield { type: "text", text: "ok" };
      },
    });
    models.setDefault("omni", "o");
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
    const parsed = parseTelegramConfig({
      token: "tok",
      allowedChatIds: [1],
      poll: false,
      apiFetch: async (url) => {
        if (String(url).includes("getFile")) {
          return new Response(
            JSON.stringify({ ok: true, result: { file_path: "photos/a.png" } }),
            { status: 200 },
          );
        }
        return new Response(png, { status: 200 });
      },
    });
    const signal = new AbortController().signal;
    const content = await telegramInboundContent(
      ctx,
      parsed,
      {
        photo: [{ file_id: "small" }, { file_id: "large" }],
        text: "caption",
      },
      signal,
    );
    expect(content?.text).toBe("caption");
    expect(content?.images).toHaveLength(1);
    expect(content?.images?.[0]?.mime).toBe("image/png");
  });

  it("ignores photo when omni is not configured", async () => {
    const ctx = new Context();
    ctx.plugin(modelsPlugin);
    const parsed = parseTelegramConfig({
      token: "tok",
      allowedChatIds: [1],
      poll: false,
      apiFetch: async () => new Response("{}", { status: 200 }),
    });
    const signal = new AbortController().signal;
    expect(
      await telegramInboundContent(
        ctx,
        parsed,
        { photo: [{ file_id: "x" }] },
        signal,
      ),
    ).toBeUndefined();
  });
});
