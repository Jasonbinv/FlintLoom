/** @vitest-environment jsdom */

import { describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AntvInfographicView, antvDesignWidth, infographicFitSize } from "../src/AntvInfographicView.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { renderImpl } = vi.hoisted(() => ({
  renderImpl: vi.fn(),
}));

vi.mock("@antv/infographic", () => ({
  Infographic: class {
    constructor(options: { container?: HTMLElement }) {
      this.container = options.container;
    }
    container?: HTMLElement;
    render(syntax: string) {
      renderImpl(syntax, this.container);
    }
    destroy() {}
    on() {}
    off() {}
  },
}));

describe("AntvInfographicView", () => {
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
    renderImpl.mockReset();
  }

  it("shows a compact fallback when AntV paints nothing", () => {
    mount(<AntvInfographicView syntax="infographic missing-data\n" />);
    expect(container!.querySelector(".a2ui-fallback")).toBeTruthy();
    expect(container!.textContent).toContain("信息图无法显示");
    const host = container!.querySelector(".a2ui-infographic-fit");
    expect(host).toBeTruthy();
    expect((host as HTMLElement).hidden).toBe(true);
    unmount();
  });

  it("repairs stepList syntax before calling AntV", () => {
    renderImpl.mockImplementation((_syntax: string, el?: HTMLElement) => {
      el?.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
    });
    mount(
      <AntvInfographicView
        syntax={"infographic stepList\nstep 1: 接收指令\n理解意图\nstep 2: 任务规划\n拆解步骤\n"}
      />,
    );
    expect(renderImpl).toHaveBeenCalled();
    const syntax = renderImpl.mock.calls[0]?.[0] as string;
    expect(syntax).toContain("list-column-simple-vertical-arrow");
    expect(syntax).toContain("data\n  lists");
    expect(syntax).toContain("接收指令");
    expect(container!.querySelector(".a2ui-fallback")).toBeNull();
    expect((container!.querySelector(".a2ui-infographic-fit") as HTMLElement).hidden).toBe(false);
    unmount();
  });

  it("repairs YAML-style mindmap syntax before calling AntV", () => {
    renderImpl.mockImplementation((_syntax: string, el?: HTMLElement) => {
      el?.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
    });
    mount(
      <AntvInfographicView
        syntax={"infographic mindmap\nroot\n label: AI 学习路径\n children:\n label: 1. 基础准备\n children:\n label: 数学\n"}
      />,
    );
    const syntax = renderImpl.mock.calls[0]?.[0] as string;
    expect(syntax).toContain("hierarchy-mindmap-branch-gradient-capsule-item");
    expect(syntax).toContain("data\n  root");
    expect(syntax).toContain("label AI 学习路径");
    expect(syntax).toContain("- label 1. 基础准备");
    expect(syntax).toContain("- label 数学");
    expect(syntax).not.toMatch(/label:/);
    expect(container!.querySelector(".a2ui-fallback")).toBeNull();
    unmount();
  });

  it("sizes the painted svg to the pane width and only shrinks when too tall", () => {
    renderImpl.mockImplementation((_syntax: string, el?: HTMLElement) => {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("width", "800px");
      svg.setAttribute("height", "400px");
      svg.setAttribute("viewBox", "0 0 800 400");
      el?.appendChild(svg);
    });
    const prevClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get() {
        return 520;
      },
    });
    try {
      mount(
        <AntvInfographicView
          syntax={"infographic list-column-simple-vertical-arrow\ndata\n  lists\n    - label A\n      desc Start\n"}
        />,
      );
      const host = container!.querySelector(".a2ui-infographic--antv") as HTMLElement | null;
      const svg = container!.querySelector("svg") as SVGSVGElement | null;
      expect(svg).toBeTruthy();
      expect(host?.style.transform).toBe("");
      expect(svg?.getAttribute("viewBox")).toBe("0 0 800 400");
      expect(Number.parseFloat(svg?.getAttribute("width") ?? "0")).toBe(520);
      expect(Number.parseFloat(svg?.getAttribute("height") ?? "0")).toBe(260);
    } finally {
      unmount();
      if (prevClientWidth) {
        Object.defineProperty(HTMLElement.prototype, "clientWidth", prevClientWidth);
      }
    }
  });

  it("caps AntV design width so ultra-wide panes do not inflate the layout", () => {
    expect(antvDesignWidth(0)).toBe(520);
    expect(antvDesignWidth(400)).toBe(400);
    expect(antvDesignWidth(900)).toBe(640);
  });

  it("fills pane width and only shrinks when the graphic would exceed max height", () => {
    expect(infographicFitSize(800, 400, 400, 560)).toEqual({ width: 400, height: 200 });
    expect(infographicFitSize(800, 1200, 400, 560)).toEqual({
      width: (800 * 560) / 1200,
      height: 560,
    });
    expect(infographicFitSize(0, 100, 400, 560)).toEqual({ width: 400, height: 0 });
  });
});
