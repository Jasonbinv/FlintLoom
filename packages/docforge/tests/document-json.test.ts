import { describe, expect, it } from "vitest";
import { parseDocumentJson } from "../src/document-json.ts";
import { blocksToMarkdown } from "../src/blocks-to-markdown.ts";

describe("parseDocumentJson", () => {
  it("parses blocks array", () => {
    const blocks = parseDocumentJson(
      JSON.stringify({
        blocks: [
          { type: "heading", level: 2, text: "Hi" },
          { type: "paragraph", text: "body" },
        ],
      }),
    );
    expect(blocks).toEqual([
      { type: "heading", level: 2, text: "Hi" },
      { type: "paragraph", text: "body" },
    ]);
  });

  it("parses table shorthand", () => {
    const blocks = parseDocumentJson(
      JSON.stringify({ headers: ["H"], rows: [["cell"]] }),
    );
    expect(blocks).toEqual([{ type: "table", headers: ["H"], rows: [["cell"]] }]);
  });

  it("rejects invalid json and shapes", () => {
    expect(() => parseDocumentJson("{")).toThrow(/unreadable/);
    expect(() => parseDocumentJson(JSON.stringify({ blocks: [{}] }))).toThrow(/unreadable/);
  });
});

describe("blocksToMarkdown", () => {
  it("renders gfm table and trailing newline", () => {
    const md = blocksToMarkdown([
      { type: "heading", level: 1, text: "Hello" },
      { type: "table", headers: ["A"], rows: [["b"]] },
    ]);
    expect(md.endsWith("\n")).toBe(true);
    expect(md).toContain("# Hello");
    expect(md).toContain("| A |");
    expect(md).toContain("| b |");
  });
});
