import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "../src/parse.ts";
import { probe } from "../src/probe.ts";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("probe/parse md html unknown", () => {
  it("probes and parses markdown and html", async () => {
    const mdProbe = await probe(join(fixtures, "sample.md"));
    expect(mdProbe).toEqual({ type: "md", parseable: true });
    expect(await parse(join(fixtures, "sample.md"))).toContain("Hello");

    const htmlProbe = await probe(join(fixtures, "sample.html"));
    expect(htmlProbe).toEqual({ type: "html", parseable: true });
    expect(await parse(join(fixtures, "sample.html"))).toMatch(/Hello/);
  });

  it("rejects unknown binary", async () => {
    const result = await probe(join(fixtures, "binary.bin"));
    expect(result.type).toBe("unknown");
    expect(result.parseable).toBe(false);
    expect(await parse(join(fixtures, "binary.bin"))).toBe(
      "failed: unsupported type",
    );
  });

  it("reports not found", async () => {
    const missing = join(fixtures, "no-such-file.md");
    expect(await probe(missing)).toEqual({
      type: "unknown",
      parseable: false,
      reason: "not found",
    });
    expect(await parse(missing)).toBe("failed: not found");
  });

  it("strips BOM and truncates long markdown", async () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-doc-"));
    const bomPath = join(dir, "bom.md");
    writeFileSync(bomPath, "\uFEFF# Hello\n");
    expect(await parse(bomPath)).toBe("# Hello\n");

    const longPath = join(dir, "long.md");
    writeFileSync(longPath, "a".repeat(200_001));
    const text = await parse(longPath);
    expect(text.startsWith("a".repeat(200_000))).toBe(true);
    expect(text).toContain(
      "[truncated: output exceeded 200000 characters]",
    );
  });
});
