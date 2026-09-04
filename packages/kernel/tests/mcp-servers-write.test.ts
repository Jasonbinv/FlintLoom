import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  deleteWorkspaceMcpServer,
  listMcpServerDeclarations,
  loadMcpServersFile,
  MCP_SERVERS_HOME_REL,
  MCP_SERVERS_WORKSPACE_FILE,
  setWorkspaceMcpEnabled,
  upsertWorkspaceMcpServer,
} from "../src/index.ts";

function tmpDirs(): { workspaceRoot: string; homeDir: string } {
  return {
    workspaceRoot: mkdtempSync(join(tmpdir(), "flintloom-mcp-w-")),
    homeDir: mkdtempSync(join(tmpdir(), "flintloom-mcp-h-")),
  };
}

function writeHomeServers(homeDir: string, text: string): void {
  mkdirSync(join(homeDir, ".flintloom"), { recursive: true });
  writeFileSync(join(homeDir, MCP_SERVERS_HOME_REL), text, "utf8");
}

function writeWorkspaceServers(workspaceRoot: string, text: string): void {
  writeFileSync(join(workspaceRoot, MCP_SERVERS_WORKSPACE_FILE), text, "utf8");
}

function workspaceText(workspaceRoot: string): string {
  return readFileSync(join(workspaceRoot, MCP_SERVERS_WORKSPACE_FILE), "utf8");
}

describe("listMcpServerDeclarations", () => {
  it("returns empty when home and workspace files are missing", () => {
    const { workspaceRoot, homeDir } = tmpDirs();
    expect(listMcpServerDeclarations({ workspaceRoot, homeDir })).toEqual([]);
  });

  it("merges home then workspace override and marks writable only for workspace ids", () => {
    const { workspaceRoot, homeDir } = tmpDirs();
    writeHomeServers(
      homeDir,
      `servers:
  - id: shared
    command: home-cmd
    args: [h.mjs]
  - id: home-only
    command: home-only-cmd
`,
    );
    writeWorkspaceServers(
      workspaceRoot,
      `servers:
  - id: shared
    command: ws-cmd
    enabled: false
  - id: ws-only
    command: ws-only-cmd
`,
    );

    const listed = listMcpServerDeclarations({ workspaceRoot, homeDir });
    expect(listed).toEqual([
      {
        id: "shared",
        command: "ws-cmd",
        enabled: false,
        source: "workspace",
        writable: true,
      },
      {
        id: "home-only",
        command: "home-only-cmd",
        enabled: true,
        source: "home",
        writable: false,
      },
      {
        id: "ws-only",
        command: "ws-only-cmd",
        enabled: true,
        source: "workspace",
        writable: true,
      },
    ]);
  });
});

describe("upsertWorkspaceMcpServer", () => {
  it("creates mcp-servers.yml with servers skeleton then the new row", () => {
    const { workspaceRoot } = tmpDirs();
    upsertWorkspaceMcpServer(workspaceRoot, {
      id: "fake",
      command: "node",
      args: ["a.mjs"],
      env: ["FAKE_TOKEN"],
    });

    const path = join(workspaceRoot, MCP_SERVERS_WORKSPACE_FILE);
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, "utf8");
    expect(text).not.toMatch(/enabled:/);
    expect(loadMcpServersFile(text)).toEqual([
      {
        id: "fake",
        command: "node",
        args: ["a.mjs"],
        env: ["FAKE_TOKEN"],
      },
    ]);
  });

  it("replaces an existing workspace row with the same id", () => {
    const { workspaceRoot } = tmpDirs();
    writeWorkspaceServers(
      workspaceRoot,
      `servers:
  - id: fake
    command: old
    args: [old.mjs]
`,
    );
    upsertWorkspaceMcpServer(workspaceRoot, {
      id: "fake",
      command: "new",
    });
    expect(loadMcpServersFile(workspaceText(workspaceRoot))).toEqual([
      { id: "fake", command: "new" },
    ]);
  });

  it("throws id for an invalid plugin id and does not create the file", () => {
    const { workspaceRoot } = tmpDirs();
    expect(() =>
      upsertWorkspaceMcpServer(workspaceRoot, {
        id: "a/b",
        command: "node",
      }),
    ).toThrow(/^id$/);
    expect(existsSync(join(workspaceRoot, MCP_SERVERS_WORKSPACE_FILE))).toBe(
      false,
    );
  });

  it("does not write enabled: true", () => {
    const { workspaceRoot } = tmpDirs();
    upsertWorkspaceMcpServer(workspaceRoot, {
      id: "fake",
      command: "node",
      enabled: true,
    });
    expect(workspaceText(workspaceRoot)).not.toMatch(/enabled:/);
  });
});

describe("setWorkspaceMcpEnabled", () => {
  it("writes enabled: false then removes the key when enabled again", () => {
    const { workspaceRoot } = tmpDirs();
    writeWorkspaceServers(
      workspaceRoot,
      `# keep this comment
servers:
  - id: fake
    command: node
`,
    );

    setWorkspaceMcpEnabled(workspaceRoot, "fake", false);
    const offText = workspaceText(workspaceRoot);
    expect(offText).toMatch(/enabled:\s*false/);
    expect(offText).toContain("# keep this comment");
    expect(loadMcpServersFile(offText)[0]?.enabled).toBe(false);

    setWorkspaceMcpEnabled(workspaceRoot, "fake", true);
    const onText = workspaceText(workspaceRoot);
    expect(onText).not.toMatch(/enabled:/);
    expect(onText).toContain("# keep this comment");
    expect(loadMcpServersFile(onText)[0]?.enabled).toBeUndefined();
  });
});

describe("deleteWorkspaceMcpServer", () => {
  it("removes the workspace row", () => {
    const { workspaceRoot } = tmpDirs();
    writeWorkspaceServers(
      workspaceRoot,
      `servers:
  - id: fake
    command: node
  - id: keep
    command: node
`,
    );
    deleteWorkspaceMcpServer(workspaceRoot, "fake");
    expect(loadMcpServersFile(workspaceText(workspaceRoot))).toEqual([
      { id: "keep", command: "node" },
    ]);
  });
});

describe("home-only ids", () => {
  it("throws home when deleting or toggling an id that exists only in home", () => {
    const { workspaceRoot, homeDir } = tmpDirs();
    writeHomeServers(
      homeDir,
      `servers:
  - id: personal
    command: node
`,
    );
    writeWorkspaceServers(
      workspaceRoot,
      `servers:
  - id: ws-only
    command: node
`,
    );

    expect(() => deleteWorkspaceMcpServer(workspaceRoot, "personal")).toThrow(
      /^home$/,
    );
    expect(() =>
      setWorkspaceMcpEnabled(workspaceRoot, "personal", false),
    ).toThrow(/^home$/);
    expect(loadMcpServersFile(workspaceText(workspaceRoot))).toEqual([
      { id: "ws-only", command: "node" },
    ]);
  });
});
