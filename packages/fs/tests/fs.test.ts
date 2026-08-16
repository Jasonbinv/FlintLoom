import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WorkspaceEscapeError } from "@flintloom/tools";
import { createFsTool } from "../src/index.ts";

function createExec(workspaceRoot: string) {
  return {
    workspaceRoot,
    signal: new AbortController().signal,
    channel: "cli",
  };
}

describe("createFsTool", () => {
  it("reads, writes, and rejects paths outside the workspace", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-fs-"));
    const exec = createExec(workspace);
    const fs = createFsTool();

    await fs.execute(
      { action: "write", path: "hello.txt", content: "alpha" },
      exec,
    );

    const content = await fs.execute(
      { action: "read", path: "hello.txt" },
      exec,
    );
    expect(content).toBe("alpha");

    await expect(
      fs.execute({ action: "read", path: "../x" }, exec),
    ).rejects.toThrow(WorkspaceEscapeError);
  });

  it("writes a file under nested directories that do not exist yet", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-fs-"));
    const exec = createExec(workspace);
    const fs = createFsTool();

    await fs.execute(
      { action: "write", path: "a/b/c.txt", content: "nested" },
      exec,
    );

    const content = await fs.execute(
      { action: "read", path: "a/b/c.txt" },
      exec,
    );
    expect(content).toBe("nested");
  });
});
