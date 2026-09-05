/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import {
  buildA2uiSurfaceHtmlBody,
  buildA2uiSurfaceHtmlDocument,
  buildA2uiSurfaceMarkdown,
  captureA2uiVisualPngs,
  collectA2uiExportSections,
  markdownForWordConvert,
  markdownToHtmlForA2uiExport,
  normalizeEmojiKeycapListsForWord,
  suggestA2uiExportFilename,
  wrapHtmlForWordClipboard,
} from "../src/a2uiSurfaceExport.ts";

function reportMessages() {
  return [
    {
      version: "v0.9" as const,
      createSurface: { surfaceId: "report-h1", catalogId: "flintloom:a2ui:core" },
    },
    {
      version: "v0.9" as const,
      updateComponents: {
        surfaceId: "report-h1",
        components: [
          { id: "root", component: "Column", children: ["title", "intro", "tbl", "chart"] },
          { id: "title", component: "Text", text: "📊 2024年上半年业务分析报告" },
          { id: "intro", component: "Text", text: "以下是基于销售数据的综合统计分析：" },
          {
            id: "tbl",
            component: "DataTable",
            title: "产品品类占比",
            headers: ["品类", "份额"],
            rows: [
              ["电子产品", "35%"],
              ["家居用品", "25%"],
            ],
          },
          {
            id: "chart",
            component: "Chart",
            kind: "line",
            title: "月度趋势",
            labels: ["1月", "2月"],
            values: [120, 180],
          },
        ],
      },
    },
  ];
}

function boundMessages() {
  return [
    {
      version: "v0.9" as const,
      createSurface: { surfaceId: "bound", catalogId: "flintloom:a2ui:core" },
    },
    {
      version: "v0.9" as const,
      updateComponents: {
        surfaceId: "bound",
        components: [
          { id: "root", component: "Column", children: ["tbl", "chart"] },
          { id: "tbl", component: "DataTable", data: { path: "/tbl" } },
          { id: "chart", component: "Chart", kind: "bar", data: { path: "/chart" } },
        ],
      },
    },
    {
      version: "v0.9" as const,
      updateDataModel: {
        surfaceId: "bound",
        path: "/tbl",
        value: { headers: ["sku", "qty"], rows: [["widget", "9"]] },
      },
    },
    {
      version: "v0.9" as const,
      updateDataModel: {
        surfaceId: "bound",
        path: "/chart",
        value: { labels: ["Jan", "Feb"], values: [1, 3] },
      },
    },
  ];
}

describe("a2uiSurfaceExport", () => {
  it("collects text, table and chart sections in tree order", () => {
    const sections = collectA2uiExportSections(reportMessages());
    expect(sections.map((section) => section.kind)).toEqual([
      "markdown",
      "markdown",
      "datatable",
      "chart",
    ]);
  });

  it("builds markdown with table, chart data and visual footnote", () => {
    const markdown = buildA2uiSurfaceMarkdown(reportMessages(), {
      chart: "data:image/png;base64,abc123",
    });
    expect(markdown).toContain("📊 2024年上半年业务分析报告");
    expect(markdown).toContain("### 产品品类占比");
    expect(markdown).toContain("| 电子产品 | 35% |");
    expect(markdown).toContain("### 月度趋势");
    expect(markdown).toContain("| 1月 | 120 |");
    expect(markdown).not.toContain("data:image/png;base64");
    expect(markdown).toContain("导出 HTML");
  });

  it("embeds chart png when explicitly requested", () => {
    const markdown = buildA2uiSurfaceMarkdown(
      reportMessages(),
      { chart: "data:image/png;base64,abc123" },
      { includeChartImages: true, chartVisualFootnote: false },
    );
    expect(markdown).toContain("![月度趋势](data:image/png;base64,abc123)");
  });

  it("reads bound table and chart data from the data model", () => {
    const markdown = buildA2uiSurfaceMarkdown(boundMessages());
    expect(markdown).toContain("| widget | 9 |");
    expect(markdown).toContain("| Jan | 1 |");
  });

  it("suggests filename from the first title text", () => {
    expect(suggestA2uiExportFilename(reportMessages(), "md")).toBe(
      "2024年上半年业务分析报告.md",
    );
  });

  it("builds html export with chart image", () => {
    const html = buildA2uiSurfaceHtmlDocument(
      reportMessages(),
      { chart: "data:image/png;base64,abc123" },
      "A2UI 报告",
    );
    expect(html).toContain("2024年上半年业务分析报告");
    expect(html).toContain("data:image/png;base64,abc123");
    expect(html).toContain("<table");
    expect(html).toContain("color:#111827");
    expect(html).toContain("background:#f3f4f6");
    expect(html).toContain("max-width: 1100px");
    expect(html).toContain('width="1100"');
    expect(html).not.toContain("max-width: 540px");
    expect(html).toContain("<h3>产品品类占比</h3>");
    const chartHtml = html.slice(html.indexOf("<h3>月度趋势</h3>"));
    expect(chartHtml.indexOf("<table")).toBeLessThan(chartHtml.indexOf('src="data:image/png;base64,abc123"'));
  });

  it("word-paste html keeps 540px charts after the data table", () => {
    const html = buildA2uiSurfaceHtmlBody(
      reportMessages(),
      { chart: "data:image/png;base64,abc123" },
      { wordPaste: true },
    );
    expect(html).toContain('width="540"');
    expect(html.indexOf(">1月</td>")).toBeLessThan(html.indexOf('src="data:image/png;base64,abc123"'));
  });

  it("wraps clipboard html with Word print view", () => {
    const html = wrapHtmlForWordClipboard("<p>hi</p>");
    expect(html).toContain("<!--[if gte mso 9]>");
    expect(html).toContain("<w:View>Print</w:View>");
    expect(html).toContain("<!--StartFragment-->");
  });

  it("declares utf-8 so Word does not open chinese html as gbk", () => {
    const html = wrapHtmlForWordClipboard("<p>数学基础</p>");
    expect(html).toContain('http-equiv="Content-Type"');
    expect(html).toContain("text/html; charset=utf-8");
    expect(html).toContain("数学基础");
  });

  it("drops oversized data-uri images so word convert keeps chinese text", () => {
    const huge = "A".repeat(200_000);
    const markdown = `# AI 学习路径\n\n![图](data:image/png;base64,${huge})\n\n- 数学基础\n`;
    const out = markdownForWordConvert(markdown);
    expect(out).toContain("数学基础");
    expect(out).not.toContain("data:image");
  });

  it("turns keycap numbers into ordered lists for Word", () => {
    expect(normalizeEmojiKeycapListsForWord("1⃣ 销售额增长")).toBe("1. 销售额增长");
  });

  it("wraps title emoji so Word html does not inherit body text color", () => {
    const html = markdownToHtmlForA2uiExport("# 📊 2024年上半年业务分析报告");
    expect(html).toContain("Segoe UI Emoji");
    expect(html).toContain("📊");
  });

  it("renders markdown headings and lists for html export", () => {
    const html = markdownToHtmlForA2uiExport("### 核心发现\n\n1. 增长\n2. 份额");
    expect(html).toContain("<h3>核心发现</h3>");
    expect(html).toContain("<ol>");
    expect(html).toContain("<li>增长</li>");
  });

  it("exports infographic title and outline instead of an empty file", () => {
    const messages = [
      {
        version: "v0.9" as const,
        createSurface: { surfaceId: "ig", catalogId: "flintloom:a2ui:core" },
      },
      {
        version: "v0.9" as const,
        updateComponents: {
          surfaceId: "ig",
          components: [
            {
              id: "root",
              component: "Infographic",
              syntax: [
                "infographic list-column-simple-vertical-arrow",
                "data",
                "  title AI 学习成长路径图",
                "  lists",
                "    - label 数学基础",
                "    - label 编程与数据科学",
              ].join("\n"),
            },
          ],
        },
      },
    ];
    expect(collectA2uiExportSections(messages).map((s) => s.kind)).toEqual(["infographic"]);
    const markdown = buildA2uiSurfaceMarkdown(messages);
    expect(markdown).toContain("### AI 学习成长路径图");
    expect(markdown).toContain("- 数学基础");
    expect(markdown.trim()).not.toBe("");
    const withImage = buildA2uiSurfaceMarkdown(
      messages,
      { root: "path-map.png" },
      { includeChartImages: true, chartVisualFootnote: false },
    );
    expect(withImage).toContain("![AI 学习成长路径图](path-map.png)");
    expect(withImage).toContain("- 数学基础");
    const html = buildA2uiSurfaceHtmlDocument(
      messages,
      { root: "data:image/png;base64,abc123" },
      "A2UI 报告",
    );
    expect(html).toContain("AI 学习成长路径图");
    expect(html).toContain("data:image/png;base64,abc123");
    expect(suggestA2uiExportFilename(messages, "html")).toBe("AI-学习成长路径图.html");
  });

  it("captures a chart visual from live svg when canvas png is unavailable", async () => {
    const host = document.createElement("div");
    host.innerHTML =
      '<div data-a2ui-id="chart"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10" height="10"><circle cx="5" cy="5" r="4" fill="blue"/></svg></div>';
    document.body.appendChild(host);
    const visuals = await captureA2uiVisualPngs(host);
    expect(visuals.chart).toMatch(/^data:image\//);
    expect(
      buildA2uiSurfaceHtmlBody(reportMessages(), visuals, { wordPaste: true }),
    ).toMatch(/<img /);
    host.remove();
  });

});
