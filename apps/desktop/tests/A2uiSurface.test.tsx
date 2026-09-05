/** @vitest-environment jsdom */

import { describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { A2uiSurface } from "../src/A2uiSurface.tsx";
import { saveTextFileWithPicker } from "../src/a2uiSurfaceExport.ts";

vi.mock("../src/a2uiSurfaceExport.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/a2uiSurfaceExport.ts")>();
  return {
    ...actual,
    saveTextFileWithPicker: vi.fn(async () => "downloaded" as const),
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function chartSurface(value: unknown, title?: string) {
  return [
    {
      version: "v0.9" as const,
      createSurface: { surfaceId: "dashboard_surface", catalogId: "flintloom:a2ui:core" },
    },
    {
      version: "v0.9" as const,
      updateComponents: {
        surfaceId: "dashboard_surface",
        components: [
          { id: "root", component: "Column", children: ["chart"] },
          {
            id: "chart",
            component: "Chart",
            kind: "bar",
            title,
            data: { path: "/chart" },
          },
        ],
      },
    },
    {
      version: "v0.9" as const,
      updateDataModel: {
        surfaceId: "dashboard_surface",
        path: "/chart",
        value,
      },
    },
  ];
}

describe("A2uiSurface chart binding", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  function mount(node: ReactElement) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(node);
    });
  }

  function unmount() {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = undefined;
    container = undefined;
  }

  it("draws a bar chart from quarterly object data", () => {
    mount(
      <A2uiSurface
        messages={chartSurface({ Q1: 120, Q2: 200, Q3: 150, Q4: 280 })}
        interactive={false}
        onAction={() => {}}
      />,
    );
    const svg = container!.querySelector(".a2ui-chart-svg");
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute("aria-label")).toBe("bar chart");
    expect(container!.textContent).toContain("Q1");
    expect(container!.textContent).toContain("Q4");
    const toolbar = container!.querySelector(".a2ui-surface-export-toolbar");
    expect(toolbar).toBeTruthy();
    const labels = Array.from(toolbar!.querySelectorAll("button")).map((btn) => btn.textContent);
    expect(labels).toEqual(["复制", "导出 MD", "导出 Word", "导出 HTML"]);
    unmount();
  });

  it("shows the chart title above the svg", () => {
    mount(
      <A2uiSurface
        messages={chartSurface({ Q1: 120, Q2: 200 }, "销售额走势 (万元)")}
        interactive={false}
        onAction={() => {}}
      />,
    );
    const title = container!.querySelector(".a2ui-chart-title");
    expect(title?.textContent).toBe("销售额走势 (万元)");
    const block = container!.querySelector(".a2ui-chart-block");
    expect(block?.querySelector(".a2ui-chart-svg")).toBeTruthy();
    expect(container!.querySelector(".a2ui-chart")?.contains(title)).toBe(false);
    unmount();
  });

  it("draws a chart from categories/series payloads", () => {
    mount(
      <A2uiSurface
        messages={chartSurface({
          categories: ["Q1", "Q2"],
          series: [{ name: "revenue", data: [120, 200] }],
        })}
        interactive={false}
        onAction={() => {}}
      />,
    );
    expect(container!.querySelector(".a2ui-chart-svg")).toBeTruthy();
    expect(container!.textContent).toContain("Q1");
    expect(container!.textContent).toContain("Q2");
    unmount();
  });

  it("draws a chart when bound values are numeric strings", () => {
    mount(
      <A2uiSurface
        messages={chartSurface({ labels: ["Q1", "Q2"], values: ["120", "200"] })}
        interactive={false}
        onAction={() => {}}
      />,
    );
    expect(container!.querySelector(".a2ui-chart-svg")).toBeTruthy();
    unmount();
  });

  it("shows a compact fallback instead of an empty hole when chart data cannot be read", () => {
    mount(
      <A2uiSurface
        messages={chartSurface({ note: "not a chart" })}
        interactive={false}
        onAction={() => {}}
      />,
    );
    expect(container!.querySelector(".a2ui-chart-svg")).toBeNull();
    expect(container!.querySelector(".a2ui-fallback")).toBeTruthy();
    expect(container!.textContent).toContain("图表数据无法显示");
    unmount();
  });

  it("renders markdown lists without a pre block", () => {
    mount(
      <A2uiSurface
        messages={[
          {
            version: "v0.9" as const,
            createSurface: { surfaceId: "md", catalogId: "flintloom:a2ui:core" },
          },
          {
            version: "v0.9" as const,
            updateComponents: {
              surfaceId: "md",
              components: [
                { id: "root", component: "Column", children: ["findings"] },
                {
                  id: "findings",
                  component: "Markdown",
                  text: "💡 核心发现：\n\n1. 五月增长\n2. 电子产品占比高",
                },
              ],
            },
          },
        ]}
        interactive={false}
        onAction={() => {}}
      />,
    );
    expect(container!.querySelector("pre")).toBeNull();
    expect(container!.querySelector(".a2ui-md ol")).toBeTruthy();
    expect(container!.textContent).toContain("核心发现");
    expect(container!.textContent).toContain("五月增长");
    unmount();
  });

  it("converts markdown marks inside Text components", () => {
    mount(
      <A2uiSurface
        messages={[
          {
            version: "v0.9" as const,
            createSurface: { surfaceId: "text-md", catalogId: "flintloom:a2ui:core" },
          },
          {
            version: "v0.9" as const,
            updateComponents: {
              surfaceId: "text-md",
              components: [
                { id: "root", component: "Column", children: ["note"] },
                {
                  id: "note",
                  component: "Text",
                  text: "💡 **分析解读：**\n- **雷达图**显示优势\n- **热力图**反映周期",
                },
              ],
            },
          },
        ]}
        interactive={false}
        onAction={() => {}}
      />,
    );
    expect(container!.textContent).not.toContain("**");
    expect(container!.querySelector(".a2ui-md strong")?.textContent).toContain("分析解读");
    expect(container!.querySelector(".a2ui-md ul")).toBeTruthy();
    expect(container!.querySelector(".a2ui-md li")?.textContent).toContain("雷达图");
    unmount();
  });

  it("exports markdown from the toolbar", async () => {
    mount(
      <A2uiSurface
        messages={chartSurface({ Q1: 120, Q2: 200 })}
        interactive={false}
        onAction={() => {}}
      />,
    );
    const mdBtn = Array.from(container!.querySelectorAll("button")).find(
      (btn) => btn.textContent === "导出 MD",
    );
    expect(mdBtn).toBeTruthy();
    await act(async () => {
      mdBtn!.click();
    });
    expect(saveTextFileWithPicker).toHaveBeenCalled();
    const [filename, content] = vi.mocked(saveTextFileWithPicker).mock.calls[0]!;
    expect(filename).toMatch(/\.md$/);
    expect(String(content)).toContain("| Q1 | 120 |");
    unmount();
  });
});
