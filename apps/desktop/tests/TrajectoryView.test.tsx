/** @vitest-environment jsdom */

import { describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TrajectoryView } from "../src/TrajectoryView.tsx";
import type { TrajectoryRecord } from "../src/trajectoryRecords.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const records: TrajectoryRecord[] = [
  { id: "user:t1", kind: "user", turn: 1, turnStart: true, preview: "hi", output: "hi" },
  {
    id: "assistant:t1:1",
    kind: "assistant",
    turn: 1,
    step: 1,
    preview: "hello",
    thinking: "raw-thinking-full",
    output: "hello",
    timing: { llmMs: 800, ttftMs: 120 },
  },
  {
    id: "tool:c1",
    kind: "tool",
    turn: 1,
    step: 1,
    preview: "File · a.txt → body",
    callId: "c1",
    toolName: "fs",
    args: { action: "read", path: "a.txt" },
    result: "file-body",
    toolState: "done",
    timing: { durationMs: 40 },
  },
];

describe("TrajectoryView", () => {
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

  it("selects a tool row and defaults inspector to Result", () => {
    mount(<TrajectoryView records={records} />);
    const tool = [...(container?.querySelectorAll("[data-trajectory-id]") ?? [])].find(
      (el) => el.getAttribute("data-trajectory-id") === "tool:c1",
    );
    act(() => {
      (tool as HTMLElement).click();
    });
    expect(container?.querySelector("[data-inspector-tab='result']")?.getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(container?.querySelector("[data-inspector-panel]")?.textContent).toContain("file-body");
    cleanup();
  });

  it("opens thinking tab by default for assistant with thinking", () => {
    mount(<TrajectoryView records={records} />);
    const assistant = [...(container?.querySelectorAll("[data-trajectory-id]") ?? [])].find(
      (el) => el.getAttribute("data-trajectory-id") === "assistant:t1:1",
    );
    act(() => {
      (assistant as HTMLElement).click();
    });
    expect(
      container?.querySelector("[data-inspector-tab='thinking']")?.getAttribute("aria-selected"),
    ).toBe("true");
    expect(container?.querySelector("[data-inspector-panel]")?.textContent).toContain(
      "raw-thinking-full",
    );
    cleanup();
  });

  it("scrolls to inspectCallId and selects the tool", () => {
    const onInspectDone = vi.fn();
    mount(
      <TrajectoryView records={records} inspectCallId="c1" onInspectDone={onInspectDone} />,
    );
    const tool = container?.querySelector('[data-trajectory-id="tool:c1"]');
    expect(tool?.getAttribute("aria-selected")).toBe("true");
    expect(container?.querySelector("[data-inspector-panel]")?.textContent).toContain("file-body");
    expect(onInspectDone).toHaveBeenCalled();
    cleanup();
  });

  it("shows full USER output in inspector Summary, not the truncated preview", () => {
    const full = `${"x".repeat(200)}TAIL-UNIQUE`;
    const truncated = `${"x".repeat(160)}…`;
    mount(
      <TrajectoryView
        records={[
          {
            id: "user:long",
            kind: "user",
            turn: 1,
            turnStart: true,
            preview: truncated,
            output: full,
          },
        ]}
      />,
    );
    const row = container?.querySelector('[data-trajectory-id="user:long"]');
    expect(container?.querySelector(".trajectory-preview")?.textContent).toBe(truncated);
    expect(row?.textContent).not.toContain("TAIL-UNIQUE");
    act(() => {
      (row as HTMLElement).click();
    });
    const panel = container?.querySelector("[data-inspector-panel]");
    expect(panel?.textContent).toContain(full);
    expect(panel?.textContent).toContain("TAIL-UNIQUE");
    expect(container?.querySelector(".trajectory-preview")?.textContent).toBe(truncated);
    cleanup();
  });

  it("shows empty copy when there are no records", () => {
    mount(<TrajectoryView records={[]} />);
    expect(container?.textContent).toContain("尚无轨迹");
    cleanup();
  });
});
