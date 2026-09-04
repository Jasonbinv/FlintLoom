import { describe, expect, it } from "vitest";
import { Context } from "@flintloom/kernel";
import modelsPlugin, { type ChatProvider, type ModelRegistry } from "@flintloom/models";
import { Session } from "@flintloom/session";
import toolsPlugin, { type ToolRegistry } from "@flintloom/tools";
import loopPlugin, { generationDirOf, runTurn } from "../src/index.ts";

describe("generationDirOf", () => {
  it("uses the first user line and first turn date", () => {
    const startedAt = new Date(2026, 7, 30, 12, 0, 0).getTime();
    const session = new Session("s1", {
      preload: [
        { type: "turn/start", turnId: "t1", startedAt },
        {
          type: "user/message",
          text: "做一个word和PPT示例\n本轮必须在工作区写出一份 Word 文件。",
        },
      ],
    });
    expect(generationDirOf(session)).toBe("ai_generation/2026-08-30_示例");
  });

  it("reuses the first turn folder after later turns", () => {
    const first = new Date(2026, 7, 30, 23, 0, 0).getTime();
    const next = new Date(2026, 7, 31, 1, 0, 0).getTime();
    const session = new Session("s2", {
      preload: [
        { type: "turn/start", turnId: "t1", startedAt: first },
        { type: "user/message", text: "word示例" },
        { type: "turn/end", turnId: "t1", status: "ok" },
        { type: "turn/start", turnId: "t2", startedAt: next },
        { type: "user/message", text: "再做一个PPT" },
      ],
    });
    expect(generationDirOf(session)).toBe("ai_generation/2026-08-30_示例");
  });
});

describe("runTurn generationDir", () => {
  it("passes the session generation dir into tool exec", async () => {
    let seen: string | undefined;
    let streamCall = 0;
    const fakeChat: ChatProvider = {
      async *stream() {
        streamCall += 1;
        if (streamCall === 1) {
          yield {
            type: "tool_call",
            id: "call-1",
            name: "touch",
            args: {},
          };
        } else {
          yield { type: "text", text: "done" };
        }
      },
    };
    const ctx = new Context();
    ctx.plugin(modelsPlugin);
    ctx.plugin(toolsPlugin);
    ctx.plugin(loopPlugin);
    ctx.require<ModelRegistry>("models").registerChat("fake", fakeChat);
    ctx.require<ModelRegistry>("models").setDefault("chat", "fake");
    ctx.require<ToolRegistry>("tools").register({
      name: "touch",
      description: "touch",
      parameters: {},
      async execute(_args, exec) {
        seen = exec.generationDir;
        return "ok";
      },
    });

    const session = new Session("s-gen");
    const result = await runTurn({
      ctx,
      session,
      text: "做一个word示例",
      workspaceRoot: process.cwd(),
      channel: "test",
      signal: new AbortController().signal,
    });

    expect(result.status).toBe("ok");
    const startedAt = session.events().find((e) => e.type === "turn/start");
    expect(startedAt?.type).toBe("turn/start");
    if (startedAt?.type === "turn/start") {
      expect(seen).toBe(generationDirOf(session));
      expect(seen).toMatch(/^ai_generation\/\d{4}-\d{2}-\d{2}_示例$/);
    }
  });

  it("puts the session output folder in the system message and forbids mkdir", async () => {
    let systemContent = "";
    const fakeChat: ChatProvider = {
      async *stream(req) {
        const first = req.messages[0];
        systemContent = typeof first?.content === "string" ? first.content : "";
        yield { type: "text", text: "ok" };
      },
    };
    const ctx = new Context();
    ctx.plugin(modelsPlugin);
    ctx.plugin(toolsPlugin);
    ctx.plugin(loopPlugin);
    ctx.require<ModelRegistry>("models").registerChat("fake", fakeChat);
    ctx.require<ModelRegistry>("models").setDefault("chat", "fake");

    const session = new Session("s-sys");
    const result = await runTurn({
      ctx,
      session,
      text: "把英语KET考纲做一个word",
      workspaceRoot: process.cwd(),
      channel: "test",
      signal: new AbortController().signal,
    });

    expect(result.status).toBe("ok");
    const dir = generationDirOf(session);
    expect(systemContent).toContain(dir);
    expect(systemContent).toMatch(/do not use shell mkdir/i);
    expect(systemContent).toMatch(/do not invent dates/i);
    expect(systemContent).toContain("a2ui_emit");
    expect(systemContent).toMatch(/do not switch to infographic_render/i);
    expect(systemContent).not.toMatch(/a2ui_emit only for buttons/);
  });
});
