import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createShellTool } from "../src/index.ts";

function createExec(workspaceRoot: string) {
  return {
    workspaceRoot,
    signal: new AbortController().signal,
    channel: "cli",
  };
}

describe("createShellTool", () => {
  it("runs commands in the workspace and returns output", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-shell-"));
    const exec = createExec(workspace);
    const shell = createShellTool();

    const result = await shell.execute({ command: "echo flintloom-ok" }, exec);

    expect(result).toContain("flintloom-ok");
  });
});
