import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WorkspaceEscapeError } from "@flintloom/tools";
import {
  createDocGenerateTool,
  createDocParseTool,
  createDocProbeTool,
} from "../src/tools.ts";

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

  it("generates html and maps failures", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-gtool-"));
    writeFileSync(join(workspace, "hello.md"), "# Hello\n\n发展\n");
    const tool = createDocGenerateTool();
    const exec = createExec(workspace);
    expect(JSON.parse(await tool.execute({ source: "hello.md", out: "out.html" }, exec))).toEqual({
      status: "ok",
      source: "hello.md",
      out: "out.html",
      format: "html",
    });
    expect(readFileSync(join(workspace, "out.html"), "utf8")).toContain("Hello");

    expect(await tool.execute({ out: "a.pdf" }, exec)).toBe("failed: missing source");
    expect(await tool.execute({ source: "hello.md" }, exec)).toBe("failed: missing out");
    expect(await tool.execute({ source: "hello.md", out: "a.pptx" }, exec)).toBe(
      "failed: bad out",
    );
    writeFileSync(join(workspace, "x.docx"), "x");
    expect(await tool.execute({ source: "x.docx", out: "a.pdf" }, exec)).toBe(
      "failed: bad source",
    );
    expect(await tool.execute({ source: "nope.md", out: "a.pdf" }, exec)).toBe(
      "failed: not found",
    );
    expect(await tool.execute({ source: "hello.md", out: "missing/a.pdf" }, exec)).toBe(
      "failed: missing parent",
    );
    expect(await tool.execute({ source: ".env", out: "a.md" }, exec)).toBe("failed: hidden");
    await expect(tool.execute({ source: "../x.md", out: "a.md" }, exec)).rejects.toThrow(
      WorkspaceEscapeError,
    );

    writeFileSync(join(workspace, "old.md"), "OLD\n");
    expect(JSON.parse(await tool.execute({ source: "hello.md", out: "old.md" }, exec)).status).toBe(
      "ok",
    );
    expect(readFileSync(join(workspace, "old.md"), "utf8")).toContain("Hello");
  });

  it("returns aborted when the generate signal is aborted", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-gtool-ab-"));
    const ac = new AbortController();
    ac.abort();
    const tool = createDocGenerateTool();
    expect(
      await tool.execute({ source: "a.md", out: "a.pdf" }, createExec(workspace, ac.signal)),
    ).toBe("aborted");
  });
});
