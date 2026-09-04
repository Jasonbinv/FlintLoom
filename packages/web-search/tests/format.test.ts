import { describe, expect, it } from "vitest";
import { formatSearchHits } from "../src/format.ts";
import type { SearchHit } from "../src/types.ts";

describe("formatSearchHits", () => {
  it("formats two hits with number, title, url, and snippet", () => {
    const hits: SearchHit[] = [
      { title: "First", url: "https://first.test", snippet: "snippet one" },
      { title: "Second", url: "https://second.test", snippet: "snippet two" },
    ];
    const text = formatSearchHits(hits);
    expect(text).toContain("1. First");
    expect(text).toContain("https://first.test");
    expect(text).toContain("snippet one");
    expect(text).toContain("2. Second");
    expect(text).toContain("https://second.test");
    expect(text).toContain("snippet two");
  });

  it("returns No results. for empty array", () => {
    expect(formatSearchHits([])).toBe("No results.");
  });

  it("truncates output longer than 8000 characters", () => {
    const hits: SearchHit[] = [
      { title: "Long", url: "https://long.test", snippet: "x".repeat(5000) },
      { title: "Also Long", url: "https://also.test", snippet: "y".repeat(5000) },
    ];
    const text = formatSearchHits(hits);
    expect(text.length).toBe(8000);
  });
});
