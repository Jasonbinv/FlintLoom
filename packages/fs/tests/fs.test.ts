import { mkdtempSync, writeFileSync } from "node:fs";
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

  it("writes a new root file into the session generation dir and returns that path", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-fs-gen-"));
    const generationDir = "ai_generation/2026-08-30_word示例";
    const exec = { ...createExec(workspace), generationDir };
    const fs = createFsTool();

    expect(
      await fs.execute(
        { action: "write", path: "example.md", content: "# demo\n" },
        exec,
      ),
    ).toBe(`Wrote ${generationDir}/example.md`);

    expect(await fs.execute({ action: "read", path: "example.md" }, exec)).toBe("# demo\n");
  });

  it("does not relocate an existing root file", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-fs-keep-"));
    writeFileSync(join(workspace, "README.md"), "# old\n");
    const exec = {
      ...createExec(workspace),
      generationDir: "ai_generation/2026-08-30_word示例",
    };
    const fs = createFsTool();

    expect(
      await fs.execute(
        { action: "write", path: "README.md", content: "# new\n" },
        exec,
      ),
    ).toBe("Wrote README.md");
    expect(await fs.execute({ action: "read", path: "README.md" }, exec)).toBe("# new\n");
  });
});
