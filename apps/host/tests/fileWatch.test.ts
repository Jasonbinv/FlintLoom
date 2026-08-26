import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFileWatch } from "../src/fileWatch.ts";

function tmpWorkspace(): string {
  return mkdtempSync(join(tmpdir(), "flintloom-watch-"));
}

async function waitFor(
  pred: () => boolean,
  timeoutMs = 3000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("timed out waiting for watch");
}

describe("createFileWatch", () => {
  const watches: Array<ReturnType<typeof createFileWatch>> = [];

  afterEach(() => {
    for (const w of watches) w.close();
    watches.length = 0;
  });

  function open(root: string, extra?: { debounceMs?: number; waitTimeoutMs?: number }) {
    const w = createFileWatch({
      root,
      debounceMs: extra?.debounceMs ?? 50,
      waitTimeoutMs: extra?.waitTimeoutMs ?? 200,
    });
    watches.push(w);
    return w;
  }

  it("bumps generation and records dirs/files after a visible file is written", async () => {
    const root = tmpWorkspace();
    const watch = open(root);
    expect(watch.generation()).toBe(0);
    const pending = watch.wait(0, new AbortController().signal);
    writeFileSync(join(root, "notes.md"), "hi\n");
    const payload = await pending;
    expect(payload.generation).toBe(1);
    expect(payload.dirs).toContain(".");
    expect(payload.files).toContain("notes.md");
    expect(payload.dirs).not.toContain("notes.md");
  });

  it("includes ancestor dirs for a nested file", async () => {
    const root = tmpWorkspace();
    mkdirSync(join(root, "md"));
    const watch = open(root);
    const pending = watch.wait(0, new AbortController().signal);
    writeFileSync(join(root, "md", "notes.md"), "hi\n");
    const payload = await pending;
    expect(payload.dirs).toEqual(expect.arrayContaining([".", "md"]));
    expect(payload.files).toContain("md/notes.md");
  });

  it("does not bump for .env or Office lock files", async () => {
    const root = tmpWorkspace();
    const watch = open(root, { waitTimeoutMs: 250 });
    const pending = watch.wait(0, new AbortController().signal);
    writeFileSync(join(root, ".env"), "sk-secret\n");
    writeFileSync(join(root, "~$foo.docx"), "lock\n");
    const payload = await pending;
    expect(payload.generation).toBe(0);
    expect(payload.dirs).toEqual([]);
    expect(payload.files).toEqual([]);
  });

  it("returns catch-up immediately when n !== current", async () => {
    const root = tmpWorkspace();
    const watch = open(root);
    writeFileSync(join(root, "a.md"), "a\n");
    await waitFor(() => watch.generation() >= 1);
    const t0 = Date.now();
    const payload = await watch.wait(0, new AbortController().signal);
    expect(Date.now() - t0).toBeLessThan(100);
    expect(payload.generation).toBe(watch.generation());
    expect(payload.dirs).toEqual(["."]);
    expect(payload.files).toEqual([]);
  });

  it("times out with empty dirs/files and the same generation", async () => {
    const root = tmpWorkspace();
    const watch = open(root, { waitTimeoutMs: 80 });
    const t0 = Date.now();
    const payload = await watch.wait(0, new AbortController().signal);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(70);
    expect(payload).toEqual({ generation: 0, dirs: [], files: [] });
  });

  it("rejects wait when the signal aborts", async () => {
    const root = tmpWorkspace();
    const watch = open(root, { waitTimeoutMs: 5_000 });
    const ac = new AbortController();
    const pending = watch.wait(0, ac.signal);
    ac.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("setRoot resets generation when the path changes", async () => {
    const a = tmpWorkspace();
    const b = tmpWorkspace();
    const watch = open(a);
    writeFileSync(join(a, "a.md"), "a\n");
    await waitFor(() => watch.generation() >= 1);
    watch.setRoot(b);
    expect(watch.generation()).toBe(0);
    const pending = watch.wait(0, new AbortController().signal);
    writeFileSync(join(b, "b.md"), "b\n");
    const payload = await pending;
    expect(payload.files).toContain("b.md");
  });
});
