import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ModelRegistry } from "@flintloom/models";
import { WorkspaceEscapeError } from "@flintloom/tools";
import { GENERATE_MAX_BYTES } from "../src/generate.ts";
import {
  createDocCompareTool,
  createDocConvertTool,
  createDocEditTool,
  createDocGenerateTool,
  createDocParseTool,
  createDocProbeTool,
  createDocSummarizeTool,
} from "../src/tools.ts";
import { EMPTY_PDF } from "./helpers/pdf.ts";
import { writeHelloDocx } from "./helpers/office.ts";
import { parse } from "../src/parse.ts";

function createExec(
  workspaceRoot: string,
  signal = new AbortController().signal,
  generationDir?: string,
) {
  return { workspaceRoot, signal, channel: "cli", generationDir };
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

    expect(
      JSON.parse(await tool.execute({ source: "hello.md", out: "a.xlsx" }, exec)),
    ).toEqual({
      status: "ok",
      source: "hello.md",
      out: "a.xlsx",
      format: "xlsx",
    });
    expect(await parse(join(workspace, "a.xlsx"))).toContain("Hello");
    expect(
      JSON.parse(await tool.execute({ source: "hello.md", out: "a.pptx" }, exec)),
    ).toEqual({
      status: "ok",
      source: "hello.md",
      out: "a.pptx",
      format: "pptx",
    });
    expect(await parse(join(workspace, "a.pptx"))).toContain("Hello");

    expect(await tool.execute({ out: "a.pdf" }, exec)).toBe("failed: missing source");
    expect(await tool.execute({ source: "hello.md" }, exec)).toBe("failed: missing out");
    expect(await tool.execute({ source: "hello.md", out: "a.zip" }, exec)).toBe(
      "failed: bad out",
    );
    writeFileSync(join(workspace, "x.docx"), "x");
    expect(await tool.execute({ source: "x.docx", out: "a.pdf" }, exec)).toBe(
      "failed: bad source",
    );
    expect(await tool.execute({ source: "nope.md", out: "a.pdf" }, exec)).toBe(
      "failed: not found",
    );
    expect(
      await tool.execute(
        {
          source: "# 示例文档\n\n这是正文，不是路径。",
          out: "example_word.docx",
        },
        exec,
      ),
    ).toBe("failed: source must be a file path");
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

  it("places generated files into the session generation dir", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-gtool-gen-"));
    const generationDir = "ai_generation/2026-08-30_word示例";
    mkdirSync(join(workspace, generationDir), { recursive: true });
    writeFileSync(join(workspace, generationDir, "hello.md"), "# Hello\n");
    const tool = createDocGenerateTool();
    const exec = createExec(workspace, new AbortController().signal, generationDir);
    const docx = JSON.parse(
      await tool.execute({ source: "hello.md", out: "note.docx" }, exec),
    ) as { source: string; out: string };
    expect(docx.source).toBe(`${generationDir}/hello.md`);
    expect(docx.out).toBe(`${generationDir}/note.docx`);
    expect(existsSync(join(workspace, generationDir, "note.docx"))).toBe(true);
    const pptx = JSON.parse(
      await tool.execute({ source: "hello.md", out: "slide.pptx" }, exec),
    ) as { out: string };
    expect(pptx.out).toBe(`${generationDir}/slide.pptx`);
    expect(existsSync(join(workspace, generationDir, "slide.pptx"))).toBe(true);
  });

  it("mkdirs the generation dir when generating into it", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-gtool-mkdir-"));
    writeFileSync(join(workspace, "hello.md"), "# Hello\n");
    const generationDir = "ai_generation/2026-08-30_word示例";
    const tool = createDocGenerateTool();
    const exec = createExec(workspace, new AbortController().signal, generationDir);
    const raw = JSON.parse(
      await tool.execute({ source: "hello.md", out: "note.docx" }, exec),
    ) as { out: string };
    expect(raw.out).toBe(`${generationDir}/note.docx`);
    expect(existsSync(join(workspace, generationDir, "note.docx"))).toBe(true);
  });

  it("converts docx to md with ordered json", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-ctool-ok-"));
    await writeHelloDocx(join(workspace, "sample.docx"));
    const tool = createDocConvertTool();
    const exec = createExec(workspace);
    const raw = await tool.execute({ source: "sample.docx", out: "out.md" }, exec);
    expect(Object.keys(JSON.parse(raw))).toEqual([
      "status",
      "source",
      "out",
      "from",
      "format",
      "loss",
    ]);
    expect(JSON.parse(raw)).toEqual({
      status: "ok",
      source: "sample.docx",
      out: "out.md",
      from: "docx",
      format: "md",
      loss: "images and complex formatting discarded",
    });
  });

  it("maps convert failures without writing out", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-ctool-"));
    writeFileSync(join(workspace, "hello.md"), "# Hello\n");
    writeFileSync(join(workspace, "empty.pdf"), EMPTY_PDF);
    const tool = createDocConvertTool();
    const exec = createExec(workspace);

    expect(await tool.execute({ out: "a.pdf" }, exec)).toBe("failed: missing source");
    expect(await tool.execute({ source: "hello.md" }, exec)).toBe("failed: missing out");
    expect(
      JSON.parse(await tool.execute({ source: "hello.md", out: "a.xlsx" }, exec)),
    ).toEqual({
      status: "ok",
      source: "hello.md",
      out: "a.xlsx",
      from: "md",
      format: "xlsx",
      loss: "images skipped; emphasis flattened",
    });
    expect(
      JSON.parse(await tool.execute({ source: "hello.md", out: "a.pptx" }, exec)),
    ).toEqual({
      status: "ok",
      source: "hello.md",
      out: "a.pptx",
      from: "md",
      format: "pptx",
      loss: "images skipped; emphasis flattened",
    });
    expect(await tool.execute({ source: "nope.md", out: "a.pdf" }, exec)).toBe(
      "failed: not found",
    );
    expect(await tool.execute({ source: "hello.md", out: "missing/a.pdf" }, exec)).toBe(
      "failed: missing parent",
    );
    expect(existsSync(join(workspace, "missing"))).toBe(false);
    expect(await tool.execute({ source: ".env", out: "a.md" }, exec)).toBe("failed: hidden");
    await expect(tool.execute({ source: "../x.md", out: "a.md" }, exec)).rejects.toThrow(
      WorkspaceEscapeError,
    );
    expect(await tool.execute({ source: "empty.pdf", out: "from-empty.md" }, exec)).toBe(
      "failed: empty text",
    );
    expect(existsSync(join(workspace, "from-empty.md"))).toBe(false);

    writeFileSync(join(workspace, "old.md"), "OLD\n");
    expect(JSON.parse(await tool.execute({ source: "hello.md", out: "old.md" }, exec)).status).toBe(
      "ok",
    );
    expect(readFileSync(join(workspace, "old.md"), "utf8")).toContain("Hello");
  });

  it("returns aborted when the convert signal is aborted", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-ctool-ab-"));
    const ac = new AbortController();
    ac.abort();
    const tool = createDocConvertTool();
    expect(
      await tool.execute({ source: "a.md", out: "a.pdf" }, createExec(workspace, ac.signal)),
    ).toBe("aborted");
  });

  it("places converted files into the session generation dir", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-ctool-gen-"));
    writeFileSync(join(workspace, "hello.md"), "# Hello\n");
    const generationDir = "ai_generation/2026-08-30_word示例";
    const tool = createDocConvertTool();
    const exec = createExec(workspace, new AbortController().signal, generationDir);
    const raw = JSON.parse(
      await tool.execute({ source: "hello.md", out: "note.docx" }, exec),
    ) as { out: string };
    expect(raw.out).toBe(`${generationDir}/note.docx`);
    expect(existsSync(join(workspace, generationDir, "note.docx"))).toBe(true);
  });

  it("edits markdown with ordered json", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-etool-ok-"));
    writeFileSync(join(workspace, "hello.md"), "# Hello\n\n发展\n");
    const tool = createDocEditTool();
    const exec = createExec(workspace);
    const raw = await tool.execute(
      { path: "hello.md", old: "# Hello", new: "# Hi" },
      exec,
    );
    expect(Object.keys(JSON.parse(raw))).toEqual(["status", "path", "replaced"]);
    expect(JSON.parse(raw)).toEqual({
      status: "ok",
      path: "hello.md",
      replaced: 1,
    });
    expect(readFileSync(join(workspace, "hello.md"), "utf8")).toContain("# Hi");
  });

  it("maps edit failures without writing", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-etool-"));
    writeFileSync(join(workspace, "hello.md"), "# Hello\n");
    writeFileSync(join(workspace, "dup.md"), "foo\nfoo\n");
    writeFileSync(join(workspace, "x.docx"), "x");
    const tool = createDocEditTool();
    const exec = createExec(workspace);

    expect(await tool.execute({ old: "a", new: "b" }, exec)).toBe("failed: missing path");
    expect(await tool.execute({ path: "hello.md" }, exec)).toBe("failed: missing old");
    expect(await tool.execute({ path: "hello.md", old: "# Hello", new: 1 }, exec)).toBe(
      "failed: bad new",
    );
    expect(await tool.execute({ path: "dup.md", old: "foo", new: "bar" }, exec)).toBe(
      "failed: not unique",
    );
    expect(readFileSync(join(workspace, "dup.md"), "utf8")).toBe("foo\nfoo\n");
    expect(await tool.execute({ path: "hello.md", old: "# Missing", new: "x" }, exec)).toBe(
      "failed: not found",
    );
    expect(await tool.execute({ path: "nope.md", old: "a", new: "b" }, exec)).toBe(
      "failed: not found",
    );
    expect(await tool.execute({ path: "x.docx", old: "x", new: "y" }, exec)).toBe(
      "failed: bad source",
    );
    expect(await tool.execute({ path: ".env", old: "a", new: "b" }, exec)).toBe(
      "failed: hidden",
    );
    await expect(tool.execute({ path: "../x.md", old: "a", new: "b" }, exec)).rejects.toThrow(
      WorkspaceEscapeError,
    );

    expect(
      JSON.parse(
        await tool.execute({ path: "hello.md", old: "# Hello", new: "" }, exec),
      ).status,
    ).toBe("ok");
    expect(readFileSync(join(workspace, "hello.md"), "utf8")).not.toContain("# Hello");
  });

  it("returns aborted when the edit signal is aborted", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-etool-ab-"));
    const ac = new AbortController();
    ac.abort();
    const tool = createDocEditTool();
    expect(
      await tool.execute(
        { path: "a.md", old: "a", new: "b" },
        createExec(workspace, ac.signal),
      ),
    ).toBe("aborted");
  });

  it("compares markdown with ordered json", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-ctool-ok-"));
    writeFileSync(join(workspace, "hello.md"), "# Hello\n\n发展\n");
    writeFileSync(join(workspace, "hi.md"), "# Hi\n\n发展\n");
    const tool = createDocCompareTool();
    const exec = createExec(workspace);
    const raw = await tool.execute({ a: "hello.md", b: "hi.md" }, exec);
    expect(Object.keys(JSON.parse(raw))).toEqual([
      "status",
      "a",
      "b",
      "identical",
      "diff",
    ]);
    const body = JSON.parse(raw);
    expect(body.status).toBe("ok");
    expect(body.a).toBe("hello.md");
    expect(body.b).toBe("hi.md");
    expect(body.identical).toBe(false);
    expect(typeof body.identical).toBe("boolean");
    expect(body.diff).toContain("-# Hello");
    expect(body.diff).toContain("+# Hi");
    expect(readFileSync(join(workspace, "hello.md"), "utf8")).toContain("# Hello");
    expect(readFileSync(join(workspace, "hi.md"), "utf8")).toContain("# Hi");
  });

  it("maps compare failures without writing", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-ctool-"));
    writeFileSync(join(workspace, "hello.md"), "# Hello\n");
    writeFileSync(join(workspace, "x.bin"), Buffer.from([0, 1, 2, 3]));
    const tool = createDocCompareTool();
    const exec = createExec(workspace);

    expect(await tool.execute({ b: "hello.md" }, exec)).toBe("failed: missing a");
    expect(await tool.execute({ a: "hello.md" }, exec)).toBe("failed: missing b");
    expect(await tool.execute({ a: "nope.md", b: "hello.md" }, exec)).toBe(
      "failed: not found",
    );
    expect(await tool.execute({ a: "hello.md", b: "missing.md" }, exec)).toBe(
      "failed: not found",
    );
    expect(await tool.execute({ a: "hello.md", b: "x.bin" }, exec)).toBe(
      "failed: unsupported type",
    );
    expect(await tool.execute({ a: ".env", b: "hello.md" }, exec)).toBe(
      "failed: hidden",
    );
    await expect(tool.execute({ a: "../x.md", b: "hello.md" }, exec)).rejects.toThrow(
      WorkspaceEscapeError,
    );

    mkdirSync(join(workspace, "adir"));
    expect(await tool.execute({ a: "adir", b: "hello.md" }, exec)).toBe(
      "failed: not a file",
    );
    writeFileSync(join(workspace, "huge.md"), Buffer.alloc(GENERATE_MAX_BYTES + 1, 0x61));
    expect(await tool.execute({ a: "huge.md", b: "hello.md" }, exec)).toBe(
      "failed: too large",
    );

    const same = JSON.parse(
      await tool.execute({ a: "hello.md", b: "hello.md" }, exec),
    );
    expect(same).toEqual({
      status: "ok",
      a: "hello.md",
      b: "hello.md",
      identical: true,
      diff: "",
    });
  });

  it("returns aborted when the compare signal is aborted", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-ctool-ab-"));
    const ac = new AbortController();
    ac.abort();
    const tool = createDocCompareTool();
    expect(
      await tool.execute(
        { a: "a.md", b: "b.md" },
        createExec(workspace, ac.signal),
      ),
    ).toBe("aborted");
  });

  it("summarizes markdown with ordered json", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-stool-ok-"));
    writeFileSync(join(workspace, "hello.md"), "# Hello\n\n发展\n");
    const models = new ModelRegistry();
    let capturedTools: unknown;
    let capturedSignal: AbortSignal | undefined;
    models.registerChat("default", {
      async *stream(req, signal) {
        capturedTools = req.tools;
        capturedSignal = signal;
        yield { type: "text", text: "Short summary." };
      },
    });
    models.setDefault("chat", "default");
    const tool = createDocSummarizeTool(models);
    const exec = createExec(workspace);
    const raw = await tool.execute({ path: "hello.md" }, exec);
    expect(Object.keys(JSON.parse(raw))).toEqual(["status", "path", "summary"]);
    expect(JSON.parse(raw)).toEqual({
      status: "ok",
      path: "hello.md",
      summary: "Short summary.",
    });
    expect(JSON.parse(raw).summary).not.toContain("发展");
    expect(capturedTools).toEqual([]);
    expect(capturedSignal).toBe(exec.signal);
  });

  it("maps summarize failures without writing", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-stool-"));
    writeFileSync(join(workspace, "hello.md"), "# Hello\n");
    writeFileSync(join(workspace, "x.bin"), Buffer.from([0, 1, 2, 3]));
    writeFileSync(join(workspace, "empty.md"), "");
    const models = new ModelRegistry();
    let calls = 0;
    models.registerChat("default", {
      async *stream() {
        calls += 1;
        yield { type: "text", text: "nope" };
      },
    });
    models.setDefault("chat", "default");
    const tool = createDocSummarizeTool(models);
    const exec = createExec(workspace);

    expect(await tool.execute({}, exec)).toBe("failed: missing path");
    expect(await tool.execute({ path: "nope.md" }, exec)).toBe("failed: not found");
    expect(await tool.execute({ path: "x.bin" }, exec)).toBe(
      "failed: unsupported type",
    );
    expect(await tool.execute({ path: "empty.md" }, exec)).toBe(
      "failed: empty text",
    );
    expect(await tool.execute({ path: ".env" }, exec)).toBe("failed: hidden");
    await expect(tool.execute({ path: "../x.md" }, exec)).rejects.toThrow(
      WorkspaceEscapeError,
    );
    mkdirSync(join(workspace, "adir"));
    expect(await tool.execute({ path: "adir" }, exec)).toBe("failed: not a file");
    writeFileSync(join(workspace, "huge.md"), Buffer.alloc(GENERATE_MAX_BYTES + 1, 0x61));
    expect(await tool.execute({ path: "huge.md" }, exec)).toBe("failed: too large");
    expect(calls).toBe(0);

    const noChat = createDocSummarizeTool(new ModelRegistry());
    const unread = await noChat.execute({ path: "hello.md" }, exec);
    expect(unread).toBe("failed: unreadable");
    expect(unread).not.toContain("未配置 chat");
  });

  it("returns aborted when the summarize signal is aborted", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "flintloom-stool-ab-"));
    const ac = new AbortController();
    ac.abort();
    const tool = createDocSummarizeTool(new ModelRegistry());
    expect(
      await tool.execute({ path: "a.md" }, createExec(workspace, ac.signal)),
    ).toBe("aborted");
  });
});
