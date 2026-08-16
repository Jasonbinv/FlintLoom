import { mkdtempSync, writeFileSync } from "node:fs";
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
});
