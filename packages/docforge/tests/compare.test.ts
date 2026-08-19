import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GENERATE_MAX_BYTES, GENERATE_MAX_CHARS } from "../src/generate.ts";
import { compareDocuments } from "../src/compare.ts";
import { parse, parseToMarkdown } from "../src/parse.ts";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const helloMd = readFileSync(join(fixtures, "hello.md"), "utf8");

describe("parseToMarkdown", () => {
  it("allows empty markdown that parse still rejects", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-cmp-empty-"));
    const path = join(dir, "empty.md");
    writeFileSync(path, "");
    await expect(parseToMarkdown(path)).resolves.toEqual({
      ok: true,
      markdown: "",
    });
    expect(await parse(path)).toBe("failed: empty text");
  });

  it("does not treat a failed: prefix body as an error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-cmp-prefix-"));
    const path = join(dir, "tricky.md");
    writeFileSync(path, "failed: empty text\n# Hello\n");
    const parsed = await parseToMarkdown(path);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.markdown).toContain("# Hello");
    }
    expect(await parse(path)).toContain("# Hello");
  });
});

describe("compareDocuments", () => {
  it("diffs Hello to Hi and keeps 发展 in context", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-cmp-ok-"));
    const a = join(dir, "hello.md");
    const b = join(dir, "hi.md");
    writeFileSync(a, helloMd);
    writeFileSync(b, helloMd.replace("# Hello", "# Hi"));
    const result = await compareDocuments(a, b, "hello.md", "hi.md");
    expect(result.identical).toBe(false);
    expect(result.diff).toContain("-# Hello");
    expect(result.diff).toContain("+# Hi");
    expect(result.diff).toContain("发展");
    expect(result.diff).toContain("--- hello.md");
    expect(result.diff).toContain("+++ hi.md");
    expect(result.diff).not.toMatch(/^--- a\//m);
  });

  it("returns identical true for the same file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-cmp-same-"));
    const a = join(dir, "hello.md");
    writeFileSync(a, helloMd);
    await expect(compareDocuments(a, a, "hello.md", "hello.md")).resolves.toEqual({
      identical: true,
      diff: "",
    });
  });

  it("treats two empty markdown files as identical", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-cmp-empties-"));
    const a = join(dir, "a.md");
    const b = join(dir, "b.md");
    writeFileSync(a, "");
    writeFileSync(b, "");
    await expect(compareDocuments(a, b, "a.md", "b.md")).resolves.toEqual({
      identical: true,
      diff: "",
    });
  });

  it("treats CRLF and LF of the same text as identical", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-cmp-crlf-"));
    const a = join(dir, "lf.md");
    const b = join(dir, "crlf.md");
    writeFileSync(a, "# Hello\n发展\n");
    writeFileSync(b, "# Hello\r\n发展\r\n");
    await expect(compareDocuments(a, b, "lf.md", "crlf.md")).resolves.toEqual({
      identical: true,
      diff: "",
    });
  });

  it("rejects unknown binaries", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-cmp-bin-"));
    const a = join(dir, "a.md");
    const b = join(dir, "x.bin");
    writeFileSync(a, "# Hello\n");
    writeFileSync(b, readFileSync(join(fixtures, "binary.bin")));
    await expect(compareDocuments(a, b, "a.md", "x.bin")).rejects.toThrow(
      /unsupported type/,
    );
  });

  it("rejects files over the byte limit before reading", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-cmp-bytes-"));
    const a = join(dir, "huge.md");
    const b = join(dir, "ok.md");
    writeFileSync(a, Buffer.alloc(GENERATE_MAX_BYTES + 1, 0x61));
    writeFileSync(b, "# Hello\n");
    await expect(compareDocuments(a, b, "huge.md", "ok.md")).rejects.toThrow(
      /too large/,
    );
  });

  it("rejects markdown over the char limit after normalize", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-cmp-chars-"));
    const a = join(dir, "huge.md");
    const b = join(dir, "ok.md");
    writeFileSync(a, "x".repeat(GENERATE_MAX_CHARS + 1));
    writeFileSync(b, "# Hello\n");
    await expect(compareDocuments(a, b, "huge.md", "ok.md")).rejects.toThrow(
      /too large/,
    );
  });

  it("rejects a patch that exceeds GENERATE_MAX_CHARS", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-cmp-patch-"));
    const a = join(dir, "a.md");
    const b = join(dir, "b.md");
    writeFileSync(a, `${"a".repeat(180_000)}\n`);
    writeFileSync(b, `${"b".repeat(180_000)}\n`);
    await expect(compareDocuments(a, b, "a.md", "b.md")).rejects.toThrow(
      /too large/,
    );
  });
});
