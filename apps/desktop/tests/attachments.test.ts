import { describe, expect, it } from "vitest";
import {
  appendAttachmentPaths,
  filesToAttachFromClipboard,
  nextAttachmentPath,
  safeAttachmentName,
} from "../src/attachments.ts";

function clipboardOf(options: {
  text?: string;
  files?: File[];
}): {
  getData: (format: string) => string;
  files: File[];
  items: Array<{ kind: string; type: string; getAsFile: () => File | null }>;
} {
  const files = options.files ?? [];
  return {
    getData: (format: string) => (format === "text/plain" ? (options.text ?? "") : ""),
    files,
    items: files.map((file) => ({
      kind: "file",
      type: file.type,
      getAsFile: () => file,
    })),
  };
}

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

describe("filesToAttachFromClipboard", () => {
  const shot = new File([new Uint8Array([1, 2, 3])], "shot.png", { type: "image/png" });
  const notes = new File(["hello"], "notes.txt", { type: "text/plain" });

  it("attaches a screenshot when there is no plain text", () => {
    expect(filesToAttachFromClipboard(clipboardOf({ files: [shot] }))).toEqual([shot]);
  });

  it("attaches explorer files when the text is only their names", () => {
    expect(
      filesToAttachFromClipboard(clipboardOf({ text: "notes.txt\n", files: [notes] })),
    ).toEqual([notes]);
  });

  it("does not attach images when the clipboard also has real text", () => {
    expect(
      filesToAttachFromClipboard(
        clipboardOf({ text: "本月销售额如下\n结论：五月最高", files: [shot] }),
      ),
    ).toEqual([]);
  });

  it("attaches a screenshot only once when files and items both expose it", () => {
    const fromFiles = new File([new Uint8Array([1, 2, 3])], "image.png", { type: "image/png" });
    const fromItems = new File([new Uint8Array([1, 2, 3])], "image.png", { type: "image/png" });
    expect(
      filesToAttachFromClipboard({
        getData: () => "",
        files: [fromFiles],
        items: [{ kind: "file", type: "image/png", getAsFile: () => fromItems }],
      }),
    ).toEqual([fromFiles]);
  });
});

describe("nextAttachmentPath", () => {
  it("avoids names already used in the same batch", () => {
    const used = new Set<string>();
    expect(nextAttachmentPath("uploads", "a.txt", used)).toBe("uploads/a.txt");
    expect(nextAttachmentPath("uploads", "a.txt", used)).toBe("uploads/a-2.txt");
  });
});
