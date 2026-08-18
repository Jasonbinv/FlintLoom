import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Context } from "@flintloom/kernel";
import knowledgePlugin from "@flintloom/knowledge";
import modelsPlugin from "@flintloom/models";
import toolsPlugin, { type ToolRegistry } from "@flintloom/tools";
import plugin from "../src/index.ts";

describe("docforge plugin", () => {
  it("registers doc_probe, doc_parse, and doc_ingest tools", () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "flintloom-docforge-kb-")), "k.sqlite");
    const ctx = new Context();
    ctx.plugin(modelsPlugin);
    ctx.plugin(toolsPlugin);
    ctx.plugin(knowledgePlugin, { dbPath });
    ctx.plugin(plugin);
    const names = ctx.require<ToolRegistry>("tools").schemas().map((s) => s.name);
    expect(names).toContain("doc_probe");
    expect(names).toContain("doc_parse");
    expect(names).toContain("doc_ingest");
    expect(names).toContain("doc_generate");
    expect(names).toContain("doc_convert");
    expect(names).toContain("doc_edit");
  });

  it("registers doc_generate and drops it on stop", () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "flintloom-docforge-kb-")), "k.sqlite");
    const ctx = new Context();
    ctx.plugin(modelsPlugin);
    ctx.plugin(toolsPlugin);
    ctx.plugin(knowledgePlugin, { dbPath });
    const stop = ctx.plugin(plugin);
    const names = ctx.require<ToolRegistry>("tools").schemas().map((s) => s.name);
    expect(names).toContain("doc_generate");
    stop();
    expect(ctx.require<ToolRegistry>("tools").schemas().map((s) => s.name)).not.toContain(
      "doc_generate",
    );
  });

  it("registers doc_convert and drops it on stop", () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "flintloom-docforge-kb-")), "k.sqlite");
    const ctx = new Context();
    ctx.plugin(modelsPlugin);
    ctx.plugin(toolsPlugin);
    ctx.plugin(knowledgePlugin, { dbPath });
    const stop = ctx.plugin(plugin);
    const names = ctx.require<ToolRegistry>("tools").schemas().map((s) => s.name);
    expect(names).toContain("doc_convert");
    stop();
    expect(ctx.require<ToolRegistry>("tools").schemas().map((s) => s.name)).not.toContain(
      "doc_convert",
    );
  });

  it("registers doc_edit and drops it on stop", () => {
    const dbPath = join(mkdtempSync(join(tmpdir(), "flintloom-docforge-kb-")), "k.sqlite");
    const ctx = new Context();
    ctx.plugin(modelsPlugin);
    ctx.plugin(toolsPlugin);
    ctx.plugin(knowledgePlugin, { dbPath });
    const stop = ctx.plugin(plugin);
    const names = ctx.require<ToolRegistry>("tools").schemas().map((s) => s.name);
    expect(names).toContain("doc_edit");
    stop();
    expect(ctx.require<ToolRegistry>("tools").schemas().map((s) => s.name)).not.toContain(
      "doc_edit",
    );
  });

  it("apply without knowledge throws knowledge", () => {
    const ctx = new Context();
    ctx.plugin(modelsPlugin);
    ctx.plugin(toolsPlugin);
    expect(() => ctx.plugin(plugin)).toThrow(/knowledge/);
  });
});
