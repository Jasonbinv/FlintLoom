import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Context } from "@flintloom/kernel";
import modelsPlugin from "@flintloom/models";
import toolsPlugin, { type ToolRegistry } from "@flintloom/tools";
import plugin from "../src/index.ts";
import type { KnowledgeService } from "../src/types.ts";

describe("knowledge plugin", () => {
  it("registers knowledge_search and stop() closes the store", async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "flintloom-kb-plug-")), "k.sqlite");
    const ctx = new Context();
    await ctx.plugin(modelsPlugin);
    await ctx.plugin(toolsPlugin);
    const stop = await ctx.plugin(plugin, { dbPath });
    const tools = ctx.require<ToolRegistry>("tools");
    expect(tools.schemas().map((s) => s.name)).toContain("knowledge_search");
    const kb = ctx.require<KnowledgeService>("knowledge");
    stop();
    expect(tools.schemas().map((s) => s.name)).not.toContain("knowledge_search");
    expect(() =>
      kb.ingest({
        workspaceRoot: dbPath,
        relPath: "a.md",
        title: "a",
        status: "ok",
        body: "hi",
      }),
    ).toThrow();
  });
});
