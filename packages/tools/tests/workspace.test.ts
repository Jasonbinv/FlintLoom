import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveInside, WorkspaceEscapeError } from "../src/index.ts";

describe("resolveInside", () => {
  it("throws WorkspaceEscapeError for paths outside the workspace", () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-ws-"));

    expect(() => resolveInside(workspace, "../secret.txt")).toThrow(
      WorkspaceEscapeError,
    );
  });

  it("returns an absolute path under the workspace for relative paths", () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-ws-"));

    const resolved = resolveInside(workspace, "README.md");

    expect(resolved).toBe(join(workspace, "README.md"));
  });

  it("resolves nested paths whose parent directories do not exist yet", () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-ws-"));

    const resolved = resolveInside(workspace, "a/b/c.txt");

    expect(resolved).toBe(join(workspace, "a", "b", "c.txt"));
  });
});
