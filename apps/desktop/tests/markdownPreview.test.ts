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

  it("strips script tags and event handlers from raw html", () => {
    const html = renderMarkdownHtml(
      `<script>alert(1)</script><img src="x" onerror="alert(1)"><p onclick="evil()">ok</p>`,
    );
    expect(html.toLowerCase()).not.toContain("<script");
    expect(html.toLowerCase()).not.toContain("onerror");
    expect(html.toLowerCase()).not.toContain("onclick");
    expect(html).toContain("ok");
  });

  it("drops javascript urls on links", () => {
    const html = renderMarkdownHtml(`[x](javascript:alert(1))`);
    expect(html.toLowerCase()).not.toContain("javascript:");
  });

  it("renders a gfm table", () => {
    const html = renderMarkdownHtml("| 技能 | 描述 |\n|:---|:---|\n| report-a2ui | A2UI");
    expect(html).toContain("<table");
    expect(html).toContain("report-a2ui");
  });

  it("renders inline and display latex as katex", () => {
    const inline = renderMarkdownHtml("勾股 $a^2 + b^2 = c^2$ 成立");
    expect(inline).toContain("katex");
    expect(inline).not.toContain("$a^2 + b^2 = c^2$");

    const display = renderMarkdownHtml("$$ f(x) = \\int_{a}^{b} x\\,dx $$");
    expect(display).toContain("katex");
    expect(display).toContain("katex-display");
    expect(display).not.toContain("$$");
  });

  it("leaves dollar math inside code spans alone", () => {
    const html = renderMarkdownHtml("用 `$a^2$` 写行内公式");
    expect(html).not.toContain("katex");
    expect(html).toContain("$a^2$");
  });
});
