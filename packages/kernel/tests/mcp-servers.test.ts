import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadMcpServersFile,
  mergeMcpServersIntoConfig,
  MCP_SERVERS_HOME_REL,
  MCP_SERVERS_WORKSPACE_FILE,
} from "../src/index.ts";

describe("loadMcpServersFile", () => {
  it("parses servers array", () => {
    const servers = loadMcpServersFile(`
servers:
  - id: fake
    command: node
    args: [script.mjs]
    env: [FAKE_TOKEN]
`);
    expect(servers).toEqual([
      {
        id: "fake",
        command: "node",
        args: ["script.mjs"],
        env: ["FAKE_TOKEN"],
      },
    ]);
  });

  it("rejects bad shape and FLINTLOOM env names", () => {
    expect(() => loadMcpServersFile("foo: 1\n")).toThrow(/servers/);
    expect(() =>
      loadMcpServersFile(`
servers:
  - id: fake
    command: node
    env: [FLINTLOOM_API_KEY]
`),
    ).toThrow(/env/);
  });
});

describe("mergeMcpServersIntoConfig", () => {
  it("appends workspace mcp-servers.yml rows not already in flintloom.yml", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-mcp-merge-ws-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-mcp-merge-home-"));
    writeFileSync(
      join(workspaceRoot, MCP_SERVERS_WORKSPACE_FILE),
      `servers:
  - id: fake
    command: node
    args: [a.mjs]
    env: [FAKE_TOKEN]
`,
      "utf8",
    );
    writeFileSync(join(workspaceRoot, ".env"), "FAKE_TOKEN=from-dotenv\n", "utf8");

    const merged = mergeMcpServersIntoConfig(
      { plugins: [{ id: "tools", name: "@flintloom/tools" }] },
      {
        workspaceRoot,
        homeDir,
        fileEnv: { FAKE_TOKEN: "from-dotenv" },
      },
    );

    expect(merged.plugins).toHaveLength(2);
    expect(merged.plugins[1]).toMatchObject({
      id: "fake",
      name: "@flintloom/mcp",
      config: {
        command: "node",
        args: ["a.mjs"],
        env: ["FAKE_TOKEN"],
        envValues: { FAKE_TOKEN: "from-dotenv" },
      },
    });
  });

  it("workspace overrides home by id and skips duplicate flintloom ids", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-mcp-merge-ws2-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-mcp-merge-home2-"));
    mkdirSync(join(homeDir, ".flintloom"), { recursive: true });
    writeFileSync(
      join(homeDir, MCP_SERVERS_HOME_REL),
      `servers:
  - id: shared
    command: home-cmd
`,
      "utf8",
    );
    writeFileSync(
      join(workspaceRoot, MCP_SERVERS_WORKSPACE_FILE),
      `servers:
  - id: shared
    command: ws-cmd
  - id: ws-only
    command: ws2
`,
      "utf8",
    );

    const merged = mergeMcpServersIntoConfig(
      {
        plugins: [
          { id: "shared", name: "@flintloom/models" },
          { id: "tools", name: "@flintloom/tools" },
        ],
      },
      { workspaceRoot, homeDir },
    );

    expect(merged.plugins.map((p) => p.id)).toEqual(["shared", "tools", "ws-only"]);
    expect(merged.plugins[2]?.config?.command).toBe("ws2");
  });
});
