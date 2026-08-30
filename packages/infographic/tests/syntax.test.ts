import { describe, expect, it } from "vitest";
import { INFOGRAPHIC_MAX_BYTES, parseAntvSyntax } from "../src/syntax.ts";

const SAMPLE = `infographic list-row-simple-horizontal-arrow
data
  lists
    - label Step 1
      desc Start
`;

describe("parseAntvSyntax", () => {
  it("accepts a local template syntax block", () => {
    expect(parseAntvSyntax(SAMPLE)).toContain("list-row-simple-horizontal-arrow");
  });

  it("rejects remote urls, empty text, and oversized payloads", () => {
    expect(() => parseAntvSyntax("infographic x\nicon https://cdn.example/a.svg\n")).toThrow(
      /remote url/,
    );
    expect(() => parseAntvSyntax("   \n")).toThrow(/bad syntax/);
    expect(() => parseAntvSyntax("not a template\n")).toThrow(/bad syntax/);
    expect(() => parseAntvSyntax(`infographic x\n${"a".repeat(INFOGRAPHIC_MAX_BYTES)}`)).toThrow(
      /too large/,
    );
  });
});
