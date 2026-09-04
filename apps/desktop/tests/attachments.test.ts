import { describe, expect, it } from "vitest";
import {
  appendAttachmentPaths,
  nextAttachmentPath,
  safeAttachmentName,
} from "../src/attachments.ts";

describe("safeAttachmentName", () => {
  it("keeps a normal file name", () => {
    expect(safeAttachmentName("notes.txt")).toBe("notes.txt");
  });

  it("strips directories and illegal characters", () => {
    expect(safeAttachmentName("C:\\\\tmp\\\\a:b?.pdf")).toBe("a_b_.pdf");
  });

  it("strips leading dots so the file is not hidden", () => {
    expect(safeAttachmentName(".env")).toBe("env");
  });
});

describe("appendAttachmentPaths", () => {
  it("uses backtick paths so chat cards can pick them up", () => {
    expect(appendAttachmentPaths("看这个", ["uploads/a.pdf"])).toBe(
      "看这个\n`uploads/a.pdf`",
    );
  });

  it("is just the paths when the prompt is empty", () => {
    expect(appendAttachmentPaths("", ["uploads/a.pdf", "uploads/b.txt"])).toBe(
      "`uploads/a.pdf` `uploads/b.txt`",
    );
  });

  it("does not duplicate a path already in the text", () => {
    expect(appendAttachmentPaths("uploads/a.pdf", ["uploads/a.pdf"])).toBe(
      "uploads/a.pdf",
    );
  });
});

describe("nextAttachmentPath", () => {
  it("avoids names already used in the same batch", () => {
    const used = new Set<string>();
    expect(nextAttachmentPath("uploads", "a.txt", used)).toBe("uploads/a.txt");
    expect(nextAttachmentPath("uploads", "a.txt", used)).toBe("uploads/a-2.txt");
  });
});
