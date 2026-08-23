import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Context } from "@flintloom/kernel";
import modelsPlugin from "@flintloom/models";
import type { ModelRegistry } from "@flintloom/models";
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
    await expect(
      kb.ingest({
        workspaceRoot: dbPath,
        relPath: "a.md",
        title: "a",
        status: "ok",
        body: "hi",
      }),
    ).rejects.toThrow();
  });

  it("stores embeddings on ingest when embedding kind is configured", async () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "flintloom-kb-embed-")), "k.sqlite");
    const ctx = new Context();
    await ctx.plugin(modelsPlugin);
    const models = ctx.require<ModelRegistry>("models");
    ctx.effect(
      models.registerEmbedding("fake", {
        async embed(input) {
          return input.texts.map((text) => (text.includes("cats") ? [1, 0] : [0, 1]));
        },
      }),
    );
    models.setDefault("embedding", "fake");
    await ctx.plugin(toolsPlugin);
    await ctx.plugin(plugin, { dbPath });
    const kb = ctx.require<KnowledgeService>("knowledge");
    const ws = mkdtempSync(join(tmpdir(), "flintloom-kb-embed-ws-"));
    await kb.ingest({
      workspaceRoot: ws,
      relPath: "a.md",
      title: "A",
      status: "ok",
      body: "cats and dogs",
    });
    await kb.ingest({
      workspaceRoot: ws,
      relPath: "b.md",
      title: "B",
      status: "ok",
      body: "birds only",
    });
    const hits = await kb.search("cats", {
      embedQuery: async () => [1, 0],
    });
    expect(hits[0]?.path).toBe("a.md");
    kb.close();
  });
});
