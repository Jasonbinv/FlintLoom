import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isPluginId, resolvePluginEntry } from "../src/index.ts";

const APPLY_MJS = `export default {
  name: "inside",
  apply() {},
};
`;

describe("isPluginId", () => {
  it("rejects empty, dots, and separators", () => {
    expect(isPluginId("ok")).toBe(true);
    expect(isPluginId("")).toBe(false);
    expect(isPluginId(".")).toBe(false);
    expect(isPluginId("..")).toBe(false);
    expect(isPluginId("a/b")).toBe(false);
    expect(isPluginId("a\\b")).toBe(false);
  });
});

describe("resolvePluginEntry", () => {
  it("uses index.mjs when there is no package.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-entry-mjs-"));
    writeFileSync(join(dir, "index.mjs"), APPLY_MJS);
    expect(resolvePluginEntry(dir)).toBe(realpathSync(join(dir, "index.mjs")));
  });

  it("prefers package.json main when the file stays inside dir", () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-entry-main-"));
    writeFileSync(join(dir, "plugin.mjs"), APPLY_MJS);
    writeFileSync(join(dir, "index.mjs"), APPLY_MJS);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ main: "./plugin.mjs" }),
    );
    expect(resolvePluginEntry(dir)).toBe(realpathSync(join(dir, "plugin.mjs")));
  });

  it("skips main that realpath-escapes and falls through to index.mjs", () => {
    const parent = mkdtempSync(join(tmpdir(), "flintloom-entry-esc-"));
    const dir = join(parent, "plug");
    const outside = join(parent, "out");
    mkdirSync(dir);
    mkdirSync(outside);
    writeFileSync(join(outside, "x.mjs"), APPLY_MJS);
    writeFileSync(join(dir, "index.mjs"), APPLY_MJS);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ main: "../out/x.mjs" }),
    );
    expect(resolvePluginEntry(dir)).toBe(realpathSync(join(dir, "index.mjs")));
  });

  it("ignores invalid package.json and uses index.mjs", () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-entry-badjson-"));
    writeFileSync(join(dir, "package.json"), "{");
    writeFileSync(join(dir, "index.mjs"), APPLY_MJS);
    expect(resolvePluginEntry(dir)).toBe(realpathSync(join(dir, "index.mjs")));
  });

  it("throws entry when the directory has no entry file", () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-entry-none-"));
    expect(() => resolvePluginEntry(dir)).toThrow(/entry/);
  });
});
