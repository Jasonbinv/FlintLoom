import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GENERATE_MAX_BYTES } from "../src/generate.ts";
import {
  countNonOverlap,
  editMarkdown,
  normalizeMarkdown,
} from "../src/edit.ts";

const helloMd = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "fixtures/hello.md"),
  "utf8",
);

describe("normalizeMarkdown", () => {
  it("strips BOM and turns CRLF into LF", () => {
    expect(normalizeMarkdown("\uFEFF# Hello\r\n")).toBe("# Hello\n");
    expect(normalizeMarkdown("a\rb")).toBe("a\nb");
  });
});

describe("countNonOverlap", () => {
  it("counts non-overlapping hits", () => {
    expect(countNonOverlap("aaa", "aa")).toBe(1);
    expect(countNonOverlap("aaaa", "aa")).toBe(2);
    expect(countNonOverlap("hello", "x")).toBe(0);
  });
});

describe("editMarkdown", () => {
  it("replaces Hello once and keeps 发展", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-edit-ok-"));
    const path = join(dir, "hello.md");
    writeFileSync(path, helloMd);
    await expect(editMarkdown(path, "# Hello", "# Hi")).resolves.toEqual({
      replaced: 1,
    });
    const text = readFileSync(path, "utf8");
    expect(text).toContain("# Hi");
    expect(text).toContain("发展");
    expect(text).not.toContain("# Hello");
  });

  it("deletes image syntax when replacement is empty", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-edit-del-"));
    const path = join(dir, "hello.md");
    writeFileSync(path, helloMd);
    await editMarkdown(path, "![skip](x.png)", "");
    const text = readFileSync(path, "utf8");
    expect(text).not.toContain("![skip](x.png)");
    expect(text).toContain("# Hello");
  });

  it("rejects duplicate old and leaves bytes unchanged", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-edit-dup-"));
    const path = join(dir, "dup.md");
    const original = "foo\nfoo\n";
    writeFileSync(path, original);
    await expect(editMarkdown(path, "foo", "bar")).rejects.toThrow(/not unique/);
    expect(readFileSync(path, "utf8")).toBe(original);
  });

  it("rejects missing old substring", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-edit-miss-"));
    const path = join(dir, "hello.md");
    writeFileSync(path, helloMd);
    await expect(editMarkdown(path, "# Missing", "x")).rejects.toThrow(/not found/);
    expect(readFileSync(path, "utf8")).toBe(helloMd);
  });

  it("matches LF old against CRLF file and writes LF without BOM", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-edit-crlf-"));
    const path = join(dir, "hello.md");
    writeFileSync(path, "\uFEFF# Hello\r\n发展\r\n");
    await editMarkdown(path, "# Hello", "# Hi");
    const text = readFileSync(path, "utf8");
    expect(text.startsWith("\uFEFF")).toBe(false);
    expect(text).not.toContain("\r");
    expect(text.endsWith("\n")).toBe(true);
    expect(text).toContain("# Hi");
  });

  it("replaces overlapping aa in aaa once", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-edit-ov-"));
    const path = join(dir, "a.md");
    writeFileSync(path, "aaa\n");
    await editMarkdown(path, "aa", "bb");
    expect(readFileSync(path, "utf8")).toBe("bba\n");
  });

  it("rejects non-md and huge files before parsing as utf8", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-edit-bad-"));
    const docx = join(dir, "x.docx");
    writeFileSync(docx, "not-md");
    await expect(editMarkdown(docx, "a", "b")).rejects.toThrow(/bad source/);
    const huge = join(dir, "huge.md");
    writeFileSync(huge, Buffer.alloc(GENERATE_MAX_BYTES + 1, 0x61));
    await expect(editMarkdown(huge, "a", "b")).rejects.toThrow(/too large/);
  });
});
