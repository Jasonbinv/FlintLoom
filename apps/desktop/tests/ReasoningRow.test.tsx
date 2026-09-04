/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ReasoningRow } from "../src/ReasoningRow.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("ReasoningRow", () => {
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

  function cleanup() {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = undefined;
    container = undefined;
  }

  it("keeps a stable 思考中 header and a two-line peek while streaming", () => {
    mount(
      <ReasoningRow
        running
        text={"line one of thought\nline two of thought\nWait, the user is asking *me* to *make* an example."}
      />,
    );
    expect(container?.textContent).toContain("思考中");
    const peek = container?.querySelector(".reasoning-peek");
    expect(peek).not.toBeNull();
    expect(peek?.textContent).toContain("Wait, the user is asking *me* to *make* an example.");
    expect(container?.querySelector(".reasoning-body")).toBeNull();
    expect(container?.querySelector(".disclosure-row-summary")).toBeNull();
    cleanup();
  });

  it("reserves the peek slot even before any thought text arrives", () => {
    mount(<ReasoningRow running text="" />);
    expect(container?.querySelector(".reasoning-peek")).not.toBeNull();
    expect(container?.querySelector(".reasoning-body")).toBeNull();
    cleanup();
  });

  it("hides the peek and shows the full body after expanding while streaming", () => {
    const seen: boolean[] = [];
    mount(
      <ReasoningRow
        running
        text={"line one of thought\nline two of thought\nWait, the user is asking *me* to *make* an example."}
        onOpenChange={(open) => seen.push(open)}
      />,
    );
    act(() => {
      container?.querySelector("button")?.click();
    });
    expect(container?.querySelector(".reasoning-peek")).toBeNull();
    expect(container?.querySelector(".reasoning-body")?.textContent).toContain("line one of thought");
    expect(seen).toEqual([true]);
    cleanup();
  });

  it("keeps a two-line peek after thinking finishes", () => {
    mount(<ReasoningRow text={"will draw heatmap\nmore detail"} />);
    expect(container?.textContent).toContain("思考");
    expect(container?.querySelector(".disclosure-row-summary")?.textContent).toBe(
      "will draw heatmap",
    );
    const peek = container?.querySelector(".reasoning-peek");
    expect(peek).not.toBeNull();
    expect(peek?.textContent).toContain("more detail");
    expect(container?.querySelector(".reasoning-body")).toBeNull();
    act(() => {
      container?.querySelector("button")?.click();
    });
    expect(container?.querySelector(".reasoning-body")?.textContent).toContain("more detail");
    expect(container?.querySelector(".reasoning-peek")).toBeNull();
    cleanup();
  });

  it("stays expanded after finish when defaultOpen is set", () => {
    mount(<ReasoningRow defaultOpen text={"will draw heatmap\nmore detail"} />);
    expect(container?.querySelector(".reasoning-body")?.textContent).toContain("more detail");
    expect(container?.querySelector(".reasoning-peek")).toBeNull();
    expect(container?.querySelector(".disclosure-row-summary")).toBeNull();
    cleanup();
  });
});
