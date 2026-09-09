import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { probeMcpServer } from "../src/mcp-probe.ts";

describe("kernel probeMcpServer", () => {
  it("throws id when the server is not declared", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-kprobe-miss-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-kprobe-miss-h-"));
    await expect(
      probeMcpServer({
        workspaceRoot,
        homeDir,
        id: "missing",
        fileEnv: {},
        importFn: async () => ({
          probeMcpServer: async () => ({ ok: true, tools: [] }),
        }),
      }),
    ).rejects.toThrow("id");
  });

  it("throws enabled when the declaration is disabled", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-kprobe-off-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-kprobe-off-h-"));
    writeFileSync(
      join(workspaceRoot, "mcp-servers.yml"),
      `servers:\n  - id: fake\n    command: node\n    enabled: false\n`,
    );
    await expect(
      probeMcpServer({
        workspaceRoot,
        homeDir,
        id: "fake",
        fileEnv: {},
        importFn: async () => ({
          probeMcpServer: async () => ({ ok: true, tools: [] }),
        }),
      }),
    ).rejects.toThrow("enabled");
  });

  it("passes draft command and dotenv envValues into importFn probe", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-kprobe-ok-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-kprobe-ok-h-"));
    writeFileSync(
      join(workspaceRoot, "mcp-servers.yml"),
      `servers:\n  - id: fake\n    command: node\n    args: [old.js]\n    env: [FAKE_TOKEN]\n`,
    );
    let seen: Record<string, unknown> | undefined;
    const result = await probeMcpServer({
      workspaceRoot,
      homeDir,
      id: "fake",
      command: "draft-node",
      args: ["new.js"],
      env: ["FAKE_TOKEN"],
      fileEnv: { FAKE_TOKEN: "from-file" },
      importFn: async () => ({
        probeMcpServer: async (config: Record<string, unknown>) => {
          seen = config;
          return { ok: true, tools: ["mcp__fake__echo"] };
        },
      }),
    });
    expect(result).toEqual({ ok: true, tools: ["mcp__fake__echo"] });
    expect(seen).toMatchObject({
      id: "fake",
      command: "draft-node",
      args: ["new.js"],
      env: ["FAKE_TOKEN"],
      envValues: { FAKE_TOKEN: "from-file" },
      workspaceRoot,
    });
  });

  it("returns mcp when the package has no probe export", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-kprobe-nexp-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-kprobe-nexp-h-"));
    writeFileSync(
      join(workspaceRoot, "mcp-servers.yml"),
      `servers:\n  - id: fake\n    command: node\n`,
    );
    const result = await probeMcpServer({
      workspaceRoot,
      homeDir,
      id: "fake",
      fileEnv: {},
      importFn: async () => ({}),
    });
    expect(result).toEqual({ ok: false, error: "mcp" });
  });
});
