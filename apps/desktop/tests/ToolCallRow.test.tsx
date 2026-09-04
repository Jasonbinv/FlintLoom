/** @vitest-environment jsdom */

import { describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ToolCallRow } from "../src/ToolCallRow.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("ToolCallRow", () => {
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

  it("keeps OUT label and payload as a two-column pair so text is not squeezed", () => {
    mount(
      <ToolCallRow
        name="doc_generate"
        args={{ source: "shuihu.md", out: "shuihu.pptx" }}
        result='{"status":"ok","source":"shuihu.md","out":"shuihu.pptx"}'
        state="done"
        step={2}
      />,
    );
    act(() => {
      container?.querySelector("button")?.click();
    });
    const out = [...(container?.querySelectorAll(".tool-io-section") ?? [])].find(
      (el) => el.querySelector(".tool-io-label")?.textContent === "OUT",
    );
    expect(out).toBeTruthy();
    expect(out?.children).toHaveLength(2);
    expect(out?.querySelector(".tool-io-body .tool-io-text")?.textContent).toContain(
      '"status":"ok"',
    );
    cleanup();
  });

  it("inspect button does not toggle IN/OUT", () => {
    const onInspect = vi.fn();
    mount(
      <ToolCallRow
        name="fs"
        callId="c1"
        args={{ path: "a.txt" }}
        result="hello"
        state="done"
        onInspect={onInspect}
      />,
    );
    expect(container?.querySelector(".tool-io-section")).toBeNull();
    const inspect = container?.querySelector('[aria-label="在轨迹中查看"]') as HTMLButtonElement;
    act(() => {
      inspect.click();
    });
    expect(onInspect).toHaveBeenCalledWith("c1");
    expect(container?.querySelector(".tool-io-section")).toBeNull();
    act(() => {
      container?.querySelector(".disclosure-row-header")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(container?.querySelector(".tool-io-section")).toBeTruthy();
    cleanup();
  });
});
