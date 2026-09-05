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

function chartSurface(value: unknown) {
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
          { id: "chart", component: "Chart", kind: "bar", data: { path: "/chart" } },
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
