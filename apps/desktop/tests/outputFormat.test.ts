import { describe, expect, it } from "vitest";
import {
  OUTPUT_FORMATS,
  appendOutputFormatConstraint,
  exportOutPath,
  exportTargets,
  formatFromSourcePath,
  outPathFromToolResult,
} from "../src/outputFormat.ts";

describe("OUTPUT_FORMATS", () => {
  it("covers office and web deliverables", () => {
    expect(OUTPUT_FORMATS.map((item) => item.id)).toEqual([
      "docx",
      "xlsx",
      "pptx",
      "md",
      "html",
      "pdf",
    ]);
  });
});

describe("appendOutputFormatConstraint", () => {
  it("appends a pptx generate instruction after the prompt", () => {
    const text = appendOutputFormatConstraint("做一份三国介绍", "pptx");
    expect(text.startsWith("做一份三国介绍\n")).toBe(true);
    expect(text).toContain(".pptx");
    expect(text).toContain("doc_generate");
  });

  it("is just the constraint when the prompt is empty", () => {
    expect(appendOutputFormatConstraint("", "pdf")).toContain(".pdf");
    expect(appendOutputFormatConstraint("", "pdf").startsWith("\n")).toBe(false);
  });
});

describe("outPathFromToolResult", () => {
  it("returns out from a successful doc_generate matching the expected format", () => {
    expect(
      outPathFromToolResult(
        "doc_generate",
        JSON.stringify({
          status: "ok",
          source: "draft.md",
          out: "talk.pptx",
          format: "pptx",
        }),
        "pptx",
      ),
    ).toBe("talk.pptx");
  });

  it("accepts doc_convert the same way", () => {
    expect(
      outPathFromToolResult(
        "doc_convert",
        JSON.stringify({
          status: "ok",
          source: "talk.md",
          out: "talk.pdf",
          format: "pdf",
        }),
        "pdf",
      ),
    ).toBe("talk.pdf");
  });

  it("ignores a mismatched format or a failed result", () => {
    expect(
      outPathFromToolResult(
        "doc_generate",
        JSON.stringify({
          status: "ok",
          out: "talk.md",
          format: "md",
        }),
        "pptx",
      ),
    ).toBeUndefined();
    expect(
      outPathFromToolResult("doc_generate", "failed: bad out", "pptx"),
    ).toBeUndefined();
    expect(
      outPathFromToolResult("fs", '{"status":"ok","out":"talk.pptx"}', "pptx"),
    ).toBeUndefined();
  });
});

describe("formatFromSourcePath", () => {
  it("maps markdown and office extensions", () => {
    expect(formatFromSourcePath("notes.markdown")).toBe("md");
    expect(formatFromSourcePath("docs/report.DOCX")).toBe("docx");
    expect(formatFromSourcePath("plot.py")).toBeUndefined();
  });
});

describe("exportOutPath", () => {
  it("keeps the directory and stem, swaps the extension", () => {
    expect(exportOutPath("docs/report.md", "pdf")).toBe("docs/report.pdf");
    expect(exportOutPath("talk.pptx", "docx")).toBe("talk.docx");
  });
});

describe("exportTargets", () => {
  it("lists every format except the current file", () => {
    expect(exportTargets("notes.md")).toEqual([
      "docx",
      "xlsx",
      "pptx",
      "html",
      "pdf",
    ]);
    expect(exportTargets("plot.py")).toEqual([]);
  });
});
