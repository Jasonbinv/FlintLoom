import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Context } from "@flintloom/kernel";
import { ModelRegistry, type GuardProvider } from "@flintloom/models";
import modelsPlugin from "@flintloom/models";
import plugin, { ToolRegistry, WorkspaceEscapeError } from "../src/index.ts";

describe("tools plugin", () => {
  it("does not call the tool when guard denies", async () => {
    const ctx = new Context();
    ctx.plugin(modelsPlugin);
    ctx.plugin(plugin);
    const tools = ctx.require<ToolRegistry>("tools");
    let callCount = 0;
    tools.register({
      name: "touch",
      description: "touch file",
      parameters: {},
      async execute() {
        callCount += 1;
        return "touched";
      },
    });

    const models = ctx.require<ModelRegistry>("models");
    const guard: GuardProvider = {
      async gate() {
        return "deny";
      },
      async steward() {
        return { verdict: "ok", summary: "" };
      },
    };
    models.registerGuard("default-guard", guard);
    models.setDefault("guard", "default-guard");

    const result = await tools.execute(
      "touch",
      {},
      {
        workspaceRoot: process.cwd(),
        signal: new AbortController().signal,
        channel: "test",
      },
    );

    expect(callCount).toBe(0);
    expect(result).toBe("guard denied: touch");
  });

  it("throws WorkspaceEscapeError before waterfall", async () => {
    const ctx = new Context();
    ctx.plugin(modelsPlugin);
    ctx.plugin(plugin);
    const tools = ctx.require<ToolRegistry>("tools");
    let ran = false;
    ctx.hook("tools/pre-execute", async () => {
      ran = true;
      return "should-not";
    });
    tools.register({
      name: "touch",
      description: "t",
      parameters: {},
      async execute() {
        return "ok";
      },
    });
    const root = mkdtempSync(join(tmpdir(), "flintloom-tools-ws-"));
    await expect(
      tools.execute(
        "touch",
        { path: "../outside" },
        {
          workspaceRoot: root,
          signal: new AbortController().signal,
          channel: "test",
        },
      ),
    ).rejects.toBeInstanceOf(WorkspaceEscapeError);
    expect(ran).toBe(false);
  });
});
