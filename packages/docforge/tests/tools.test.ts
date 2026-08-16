import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WorkspaceEscapeError } from "@flintloom/tools";
import { createDocParseTool, createDocProbeTool } from "../src/tools.ts";

function createExec(workspaceRoot: string, signal = new AbortController().signal) {
  return { workspaceRoot, signal, channel: "cli" };
}

describe("doc tools", () => {
  it("probes and parses inside the workspace and rejects escape", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-doctool-"));
    writeFileSync(join(workspace, "README.md"), "# Hello\n");
    const exec = createExec(workspace);
    const probe = createDocProbeTool();
    const parse = createDocParseTool();

    expect(JSON.parse(await probe.execute({ path: "README.md" }, exec))).toEqual({
      type: "md",
      parseable: true,
    });
    expect(await parse.execute({ path: "README.md" }, exec)).toContain("Hello");
    expect(await parse.execute({}, exec)).toBe("failed: missing path");

    await expect(
      parse.execute({ path: "../x" }, exec),
    ).rejects.toThrow(WorkspaceEscapeError);
  });

  it("returns aborted when the signal is already aborted", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-doctool-"));
    const ac = new AbortController();
    ac.abort();
    const parse = createDocParseTool();
    expect(await parse.execute({ path: "README.md" }, createExec(workspace, ac.signal))).toBe(
      "aborted",
    );
  });
});
