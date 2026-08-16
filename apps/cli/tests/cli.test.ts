import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadOrCreateToken } from "@flintloom/host";

describe("loadOrCreateToken", () => {
  it("returns the same token on a second call for the same homeDir", () => {
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-cli-home-"));
    const first = loadOrCreateToken(homeDir);
    const second = loadOrCreateToken(homeDir);
    expect(first).toBe(second);
    expect(first.length).toBeGreaterThan(0);
  });
});
