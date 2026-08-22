import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { McpStdioClient } from "../src/client.ts";

const fixture = join(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/fake-mcp-server.mjs",
);

describe("McpStdioClient", () => {
  it("initializes and lists echo tool", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "flintloom-mcp-cwd-"));
    const client = new McpStdioClient({
      command: process.execPath,
      args: [fixture],
      cwd,
      env: { FAKE_TOKEN: "secret-value" },
    });
    await client.initialize();
    expect(client.listTools().map((t) => t.name)).toContain("echo");
    client.kill();
  });

  it("callTool echoes text without leaking env values", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "flintloom-mcp-call-"));
    const client = new McpStdioClient({
      command: process.execPath,
      args: [fixture],
      cwd,
      env: { FAKE_TOKEN: "secret-value" },
    });
    await client.initialize();
    const out = await client.callTool(
      "echo",
      { text: "hi" },
      new AbortController().signal,
    );
    expect(out).toBe("hi");
    expect(out).not.toContain("secret-value");
    client.kill();
  });
});
