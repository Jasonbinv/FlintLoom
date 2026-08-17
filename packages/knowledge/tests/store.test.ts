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
  it("ingests markdown, searches body, and upserts same path with same id", () => {
    const kb = openKnowledge(dbFile());
    const ws = mkdtempSync(join(tmpdir(), "flintloom-kb-ws-"));
    const first = kb.ingest({
      workspaceRoot: ws,
      relPath: "notes/a.md",
      title: "Notes",
      status: "ok",
      body: "# Notes\nagent should ingest notes before answering\n",
    });
    expect(first.status).toBe("ok");
    expect(kb.list()[0]?.path).toBe("notes/a.md");
    const hits = kb.search("ingest notes");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.snippet).toContain("ingest");
    expect(hits[0]?.snippet).not.toContain("x".repeat(50));

    const second = kb.ingest({
      workspaceRoot: ws,
      relPath: "notes/a.md",
      title: "Notes v2",
      status: "ok",
      body: "# Notes v2\nupdated body unique-token-xyz\n",
    });
    expect(second.id).toBe(first.id);
    expect(kb.search("unique-token-xyz")).toHaveLength(1);
    expect(kb.search("ingest notes")).toHaveLength(0);
    kb.close();
  });

  it("does not return failed rows from search", () => {
    const kb = openKnowledge(dbFile());
    const ws = mkdtempSync(join(tmpdir(), "flintloom-kb-ws-"));
    const row = kb.ingest({
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
    expect(kb.search("empty")).toHaveLength(0);
    kb.close();
  });

  it("keeps two workspaces with the same rel_path as two rows", () => {
    const kb = openKnowledge(dbFile());
    const a = mkdtempSync(join(tmpdir(), "flintloom-kb-a-"));
    const b = mkdtempSync(join(tmpdir(), "flintloom-kb-b-"));
    kb.ingest({
      workspaceRoot: a,
      relPath: "README.md",
      title: "A",
      status: "ok",
      body: "alpha-only",
    });
    kb.ingest({
      workspaceRoot: b,
      relPath: "README.md",
      title: "B",
      status: "ok",
      body: "beta-only",
    });
    expect(kb.list()).toHaveLength(2);
    expect(kb.search("alpha-only")).toHaveLength(1);
    kb.close();
  });

  it("finds short Chinese and ASCII queries via LIKE when FTS trigram misses", () => {
    const kb = openKnowledge(dbFile());
    const ws = mkdtempSync(join(tmpdir(), "flintloom-kb-short-"));
    kb.ingest({
      workspaceRoot: ws,
      relPath: "notes/zh.md",
      title: "我的笔记",
      status: "ok",
      body: "正文里有笔记和 ab token\n",
    });
    expect(kb.search("笔").length).toBeGreaterThanOrEqual(1);
    expect(kb.search("笔记").length).toBeGreaterThanOrEqual(1);
    expect(kb.search("ab").length).toBeGreaterThanOrEqual(1);
    kb.close();
  });
});
