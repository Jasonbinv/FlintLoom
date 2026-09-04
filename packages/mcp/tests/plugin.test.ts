import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  Context,
  MCP_SERVER_STATUS_KEY,
  type McpServerRuntimeStatus,
} from "@flintloom/kernel";
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
    const loaded = ctx
      .get<Map<string, McpServerRuntimeStatus>>(MCP_SERVER_STATUS_KEY)
      ?.get("fake");
    expect(loaded?.status).toBe("loaded");
    expect(loaded?.tools).toContain("mcp__fake__echo");
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

  it("isolates missing declared env at apply", async () => {
    const ctx = new Context();
    await ctx.plugin(modelsPlugin);
    await ctx.plugin(toolsPlugin);
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-mcp-miss-"));
    const secret = "leak-token-xyz";
    await expect(
      ctx.plugin(plugin, {
        id: "fake",
        command: process.execPath,
        args: [fixture],
        env: ["MISSING_ENV"],
        envValues: { FAKE_TOKEN: secret },
        workspaceRoot,
      }),
    ).resolves.toBeTypeOf("function");
    const tools = ctx.require<ToolRegistry>("tools");
    expect(tools.schemas().map((s) => s.name)).not.toContain("mcp__fake__echo");
    const status = ctx
      .get<Map<string, McpServerRuntimeStatus>>(MCP_SERVER_STATUS_KEY)
      ?.get("fake");
    expect(status?.status).toBe("error");
    expect(status?.error).toMatch(/MISSING_ENV/);
    expect(status?.error).toMatch(/missing env:/);
    expect(status?.error).not.toContain(secret);
    expect(status?.error).not.toContain(workspaceRoot);
    expect(status?.tools).toEqual([]);
  });

  it("isolates bad command at apply without unloading other plugins", async () => {
    const ctx = new Context();
    await ctx.plugin(modelsPlugin);
    await ctx.plugin(toolsPlugin);
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-mcp-badcmd-"));
    await expect(
      ctx.plugin(plugin, {
        id: "broken",
        command: "__flintloom_no_such_cmd__",
        args: [],
        workspaceRoot,
      }),
    ).resolves.toBeTypeOf("function");
    expect(ctx.get("models")).toBeDefined();
    const tools = ctx.require<ToolRegistry>("tools");
    expect(tools.schemas()).toEqual([]);
    const status = ctx
      .get<Map<string, McpServerRuntimeStatus>>(MCP_SERVER_STATUS_KEY)
      ?.get("broken");
    expect(status?.status).toBe("error");
    expect(status?.error).toBeTruthy();
    expect(status!.error!.length).toBeLessThanOrEqual(32);
    expect(status?.error).not.toContain(workspaceRoot);
    expect(status?.tools).toEqual([]);
  });
});
