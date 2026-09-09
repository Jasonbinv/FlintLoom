import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { probeMcpServer } from "../src/probe.ts";

const fixture = join(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/fake-mcp-server.mjs",
);

describe("probeMcpServer", () => {
  it("returns prefixed echo tool and does not throw", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-mcp-probe-"));
    const result = await probeMcpServer({
      id: "fake",
      command: process.execPath,
      args: [fixture],
      env: ["FAKE_TOKEN"],
      envValues: { FAKE_TOKEN: "tok" },
      workspaceRoot,
    });
    expect(result).toEqual({ ok: true, tools: ["mcp__fake__echo"] });
  });

  it("returns ok false for a missing command without throwing", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-mcp-probe-miss-"));
    const result = await probeMcpServer({
      id: "fake",
      command: join(workspaceRoot, "no-such-mcp-bin"),
      args: [],
      workspaceRoot,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toBe("mcp");
  });
});
