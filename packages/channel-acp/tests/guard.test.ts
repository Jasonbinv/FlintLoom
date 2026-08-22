import { describe, expect, it, vi } from "vitest";
import { Context } from "@flintloom/kernel";
import loopPlugin from "@flintloom/loop";
import modelsPlugin, { type GuardProvider, type ModelRegistry } from "@flintloom/models";
import sessionPlugin from "@flintloom/session";
import toolsPlugin from "@flintloom/tools";
import { AcpClientRpc } from "../src/client-rpc.ts";
import { resolveAcpGuardAsks } from "../src/guard.ts";

describe("resolveAcpGuardAsks", () => {
  it("requests permission and continues on allow", async () => {
    const ctx = new Context();
    ctx.plugin(modelsPlugin);
    ctx.plugin(toolsPlugin);
    ctx.plugin(sessionPlugin);
    ctx.plugin(loopPlugin);
    const models = ctx.require<ModelRegistry>("models");
    const guard: GuardProvider = {
      async gate() {
        return "ask";
      },
    };
    models.registerGuard("g", guard);
    models.setDefault("guard", "g");
    let toolYielded = false;
    models.registerChat("fake", {
      async *stream() {
        if (!toolYielded) {
          toolYielded = true;
          yield {
            type: "tool_call",
            id: "call-1",
            name: "touch",
            args: {},
          };
        }
        yield { type: "text", text: "done" };
      },
    });
    models.setDefault("chat", "fake");
    const tools = ctx.require<import("@flintloom/tools").ToolRegistry>("tools");
    tools.register({
      name: "touch",
      description: "touch",
      parameters: { type: "object", properties: {} },
      async execute() {
        return "tool-ok";
      },
    });
    const sessions = ctx.require<import("@flintloom/session").SessionStore>("sessions");
    const session = sessions.getOrCreate("s1");
    const loop = ctx.require<import("@flintloom/loop").LoopService>("loop");
    const run = await loop.runTurn({
      ctx,
      session,
      text: "run tool",
      workspaceRoot: process.cwd(),
      channel: "acp",
      signal: new AbortController().signal,
    });
    expect(run.status).toBe("awaiting_action");
    const clientRpc = new AcpClientRpc();
    const writes: unknown[] = [];
    const requestSpy = vi.spyOn(clientRpc, "request").mockImplementation(async () => ({
      outcome: { outcome: "selected", optionId: "allow-once" },
    }));
    const result = await resolveAcpGuardAsks({
      session,
      sessionId: "s1",
      turnId: run.turnId,
      loop,
      ctx,
      workspaceRoot: process.cwd(),
      signal: new AbortController().signal,
      clientRpc,
      writeStdout: (msg) => writes.push(msg),
    });
    expect(requestSpy).toHaveBeenCalled();
    expect(result.status).toBe("ok");
    expect(
      session.events().some(
        (e) => e.type === "tool/result" && e.text === "tool-ok",
      ),
    ).toBe(true);
  });
});
