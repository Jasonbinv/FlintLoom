import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Context } from "@flintloom/kernel";
import modelsPlugin, { type ModelRegistry } from "@flintloom/models";
import { openKnowledge } from "../src/store.ts";
import { createKnowledgeSearchTool } from "../src/tool.ts";

function exec(workspaceRoot: string, signal = new AbortController().signal) {
  return { workspaceRoot, signal, channel: "cli" };
}

describe("knowledge_search", () => {
  it("returns hits without the full body and rejects empty q", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-kb-tool-"));
    const kb = openKnowledge(join(dir, "k.sqlite"));
    const ctx = new Context();
    await ctx.plugin(modelsPlugin);
    const models = ctx.require<ModelRegistry>("models");
    const body = `hello ${"x".repeat(300)} unique-search-token`;
    await kb.ingest({
      workspaceRoot: dir,
      relPath: "a.md",
      title: "A",
      status: "ok",
      body,
    });
    const tool = createKnowledgeSearchTool(kb, models);
    const parsed = JSON.parse(
      await tool.execute({ q: "unique-search-token" }, exec(dir)),
    ) as { hits: { snippet: string }[] };
    expect(parsed.hits[0]?.snippet).toContain("unique-search-token");
    expect(parsed.hits[0]?.snippet).not.toBe(body);
    expect(JSON.stringify(parsed)).not.toContain("workspaceRoot");
    expect(await tool.execute({ q: "  " }, exec(dir))).toBe("failed: missing q");
    kb.close();
  });
});
