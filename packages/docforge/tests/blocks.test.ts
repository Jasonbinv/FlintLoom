import { describe, expect, it } from "vitest";
import { parseBlocks } from "../src/blocks.ts";

describe("parseBlocks", () => {
  it("keeps headings lists tables and skips images", () => {
    const blocks = parseBlocks(
      [
        "# Hello",
        "",
        "发展 and [x](http://example.com) plus **bold**",
        "",
        "- a",
        "  - b",
        "",
        "```",
        "code & <>",
        "```",
        "",
        "| H |",
        "| --- |",
        "| 1 |",
        "",
        "![skip](x.png)",
      ].join("\n"),
    );
    expect(blocks).toContainEqual({ type: "heading", level: 1, text: "Hello" });
    expect(blocks.some((b) => b.type === "paragraph" && b.text.includes("发展"))).toBe(
      true,
    );
    expect(blocks.some((b) => b.type === "paragraph" && b.text.includes("x"))).toBe(
      true,
    );
    expect(blocks.some((b) => b.type === "paragraph" && b.text.includes("http://"))).toBe(
      false,
    );
    const list = blocks.find((b) => b.type === "list");
    expect(list).toEqual({ type: "list", ordered: false, items: ["a", "b"] });
    expect(blocks).toContainEqual({ type: "code", text: "code & <>" });
    expect(blocks).toContainEqual({
      type: "table",
      headers: ["H"],
      rows: [["1"]],
    });
    expect(blocks.some((b) => b.type === "paragraph" && b.text.includes("skip"))).toBe(
      false,
    );
  });

  it("falls back to href for empty-label links", () => {
    const blocks = parseBlocks("see [](http://example.com) end");
    expect(
      blocks.some((b) => b.type === "paragraph" && b.text.includes("http://example.com")),
    ).toBe(true);
  });
});
