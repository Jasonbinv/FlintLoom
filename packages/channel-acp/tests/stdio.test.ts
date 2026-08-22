import { describe, expect, it } from "vitest";
import { Context } from "@flintloom/kernel";
import loopPlugin, { type LoopService } from "@flintloom/loop";
import modelsPlugin, {
  type ChatProvider,
  type ModelRegistry,
} from "@flintloom/models";
import sessionPlugin from "@flintloom/session";
import toolsPlugin from "@flintloom/tools";
import { handleAcpRequest } from "../src/stdio.ts";

describe("ACP stdio handler", () => {
  it("initialize returns protocol version", async () => {
    const ctx = new Context();
    const result = await handleAcpRequest(
      ctx,
      process.cwd(),
      { jsonrpc: "2.0", id: 0, method: "initialize", params: {} },
      { controllers: new Map(), promptControllers: new Map() },
    );
    expect(result).toMatchObject({ protocolVersion: 1 });
  });

  it("session/prompt runs a turn on channel acp", async () => {
    const ctx = new Context();
    ctx.plugin(modelsPlugin);
    ctx.plugin(toolsPlugin);
    ctx.plugin(sessionPlugin);
    ctx.plugin(loopPlugin);
    const fakeChat: ChatProvider = {
      async *stream() {
        yield { type: "text", text: "acp-reply" };
      },
    };
    ctx.require<ModelRegistry>("models").registerChat("fake", fakeChat);
    ctx.require<ModelRegistry>("models").setDefault("chat", "fake");

    const newSession = await handleAcpRequest(
      ctx,
      process.cwd(),
      { jsonrpc: "2.0", id: 1, method: "session/new", params: {} },
      { controllers: new Map(), promptControllers: new Map() },
    ) as { sessionId: string };

    const result = await handleAcpRequest(
      ctx,
      process.cwd(),
      {
        jsonrpc: "2.0",
        id: 2,
        method: "session/prompt",
        params: {
          sessionId: newSession.sessionId,
          prompt: [{ type: "text", text: "hello acp" }],
        },
      },
      { controllers: new Map(), promptControllers: new Map() },
    );
    expect(result).toEqual({ stopReason: "end_turn" });
    const loop = ctx.require<LoopService>("loop");
    expect(loop).toBeDefined();
  });
});
