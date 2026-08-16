import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createGrepTool } from "../src/index.ts";

function createExec(workspaceRoot: string) {
  return {
    workspaceRoot,
    signal: new AbortController().signal,
    channel: "cli",
  };
}

const OUTSIDE_SECRET = "flintloom-outside-secret-xyz";

describe("createGrepTool", () => {
  it("finds matching lines in workspace files", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-grep-"));
    writeFileSync(join(workspace, "hello.txt"), "alpha");
    const exec = createExec(workspace);
    const grep = createGrepTool();

    const result = await grep.execute({ pattern: "alp" }, exec);

    expect(result).toContain("hello.txt");
    expect(result).toContain("alpha");
  });

  it("does not read files outside the workspace via symlinks", async () => {
    const parent = mkdtempSync(join(tmpdir(), "flintloom-grep-parent-"));
    const workspace = mkdtempSync(join(parent, "ws-"));
    const outsideFile = join(parent, "outside-secret.txt");

    writeFileSync(join(workspace, "hello.txt"), "alpha");
    writeFileSync(outsideFile, OUTSIDE_SECRET);

    const linkPath = join(workspace, "escape-link.txt");
    let symlinkCreated = false;
    try {
      symlinkSync(outsideFile, linkPath, "file");
      symlinkCreated = true;
    } catch {
      // Symlink creation often requires elevated privilege on Windows.
    }

    if (!symlinkCreated) {
      rmSync(parent, { recursive: true, force: true });
      return;
    }

    try {
      const exec = createExec(workspace);
      const grep = createGrepTool();

      const result = await grep.execute({ pattern: OUTSIDE_SECRET }, exec);

      expect(result).not.toContain(OUTSIDE_SECRET);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});
