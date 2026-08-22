import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Context } from "@flintloom/kernel";
import modelsPlugin from "@flintloom/models";
import toolsPlugin, { type ToolRegistry } from "@flintloom/tools";
import plugin from "../src/index.ts";

const fixture = join(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/fake-mcp-server.mjs",
);

describe("mcp plugin", () => {
  it("registers mcp__fake__echo and dispose removes it", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-mcp-plug-"));
    const ctx = new Context();
    await ctx.plugin(modelsPlugin);
    await ctx.plugin(toolsPlugin);
    const stop = await ctx.plugin(plugin, {
      id: "fake",
      command: process.execPath,
      args: [fixture],
      env: ["FAKE_TOKEN"],
      envValues: { FAKE_TOKEN: "tok" },
      workspaceRoot,
    });
    const tools = ctx.require<ToolRegistry>("tools");
    expect(tools.schemas().map((s) => s.name)).toContain("mcp__fake__echo");
    const out = await tools.execute(
      "mcp__fake__echo",
      { text: "hi" },
      {
        workspaceRoot,
        signal: new AbortController().signal,
        channel: "cli",
      },
    );
    expect(out).toBe("hi");
    stop();
    expect(tools.schemas().map((s) => s.name)).not.toContain("mcp__fake__echo");
    await expect(
      tools.execute(
        "mcp__fake__echo",
        { text: "hi" },
        {
          workspaceRoot,
          signal: new AbortController().signal,
          channel: "cli",
        },
      ),
    ).rejects.toThrow(/not registered/);
  });

  it("rejects missing declared env at apply", async () => {
    const ctx = new Context();
    await ctx.plugin(modelsPlugin);
    await ctx.plugin(toolsPlugin);
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-mcp-miss-"));
    await expect(
      ctx.plugin(plugin, {
        id: "fake",
        command: process.execPath,
        args: [fixture],
        env: ["MISSING_ENV"],
        workspaceRoot,
      }),
    ).rejects.toThrow(/MISSING_ENV/);
  });
});
