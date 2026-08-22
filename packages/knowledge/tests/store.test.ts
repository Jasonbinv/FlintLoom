import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openKnowledge } from "../src/store.ts";

function dbFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "flintloom-kb-"));
  return join(dir, "knowledge.sqlite");
}

describe("openKnowledge", () => {
  it("ingests markdown, searches body, and upserts same path with same id", async () => {
    const kb = openKnowledge(dbFile());
    const ws = mkdtempSync(join(tmpdir(), "flintloom-kb-ws-"));
    const first = await kb.ingest({
      workspaceRoot: ws,
      relPath: "notes/a.md",
      title: "Notes",
      status: "ok",
      body: "# Notes\nagent should ingest notes before answering\n",
    });
    expect(first.status).toBe("ok");
    expect(kb.list()[0]?.path).toBe("notes/a.md");
    const hits = await kb.search("ingest notes");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.snippet).toContain("ingest");
    expect(hits[0]?.snippet).not.toContain("x".repeat(50));

    const second = await kb.ingest({
      workspaceRoot: ws,
      relPath: "notes/a.md",
      title: "Notes v2",
      status: "ok",
      body: "# Notes v2\nupdated body unique-token-xyz\n",
    });
    expect(second.id).toBe(first.id);
    expect(await kb.search("unique-token-xyz")).toHaveLength(1);
    expect(await kb.search("ingest notes")).toHaveLength(0);
    kb.close();
  });

  it("does not return failed rows from search", async () => {
    const kb = openKnowledge(dbFile());
    const ws = mkdtempSync(join(tmpdir(), "flintloom-kb-ws-"));
    const row = await kb.ingest({
      workspaceRoot: ws,
      relPath: "empty.md",
      title: "empty.md",
      status: "failed",
      body: "",
      failReason: "empty text",
    });
    expect(kb.list().some((item) => item.id === row.id && item.status === "failed")).toBe(
      true,
    );
    expect(await kb.search("empty")).toHaveLength(0);
    kb.close();
  });

  it("keeps two workspaces with the same rel_path as two rows", async () => {
    const kb = openKnowledge(dbFile());
    const a = mkdtempSync(join(tmpdir(), "flintloom-kb-a-"));
    const b = mkdtempSync(join(tmpdir(), "flintloom-kb-b-"));
    await kb.ingest({
      workspaceRoot: a,
      relPath: "README.md",
      title: "A",
      status: "ok",
      body: "alpha-only",
    });
    await kb.ingest({
      workspaceRoot: b,
      relPath: "README.md",
      title: "B",
      status: "ok",
      body: "beta-only",
    });
    expect(kb.list()).toHaveLength(2);
    expect(await kb.search("alpha-only")).toHaveLength(1);
    kb.close();
  });

  it("finds short Chinese and ASCII queries via LIKE when FTS trigram misses", async () => {
    const kb = openKnowledge(dbFile());
    const ws = mkdtempSync(join(tmpdir(), "flintloom-kb-short-"));
    await kb.ingest({
      workspaceRoot: ws,
      relPath: "notes/zh.md",
      title: "我的笔记",
      status: "ok",
      body: "正文里有笔记和 ab token\n",
    });
    expect((await kb.search("笔")).length).toBeGreaterThanOrEqual(1);
    expect((await kb.search("笔记")).length).toBeGreaterThanOrEqual(1);
    expect((await kb.search("ab")).length).toBeGreaterThanOrEqual(1);
    kb.close();
  });

  it("uses vector search when embedQuery returns vectors", async () => {
    const kb = openKnowledge(dbFile(), {
      embedText: async (text) => {
        if (text.includes("cats")) {
          return [1, 0];
        }
        return [0, 1];
      },
    });
    const ws = mkdtempSync(join(tmpdir(), "flintloom-kb-vec-"));
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
