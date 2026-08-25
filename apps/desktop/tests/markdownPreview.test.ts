/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import { renderMarkdownHtml } from "../src/markdownPreview.ts";

describe("renderMarkdownHtml", () => {
  it("renders headings and lists", () => {
    const html = renderMarkdownHtml("# Title\n\n- one\n- two");
    expect(html).toContain("<h1");
    expect(html).toContain("Title");
    expect(html).toContain("<ul");
    expect(html).toContain("one");
  });
});
