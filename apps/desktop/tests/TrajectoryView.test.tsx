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

  it("shows SYSTEM tag and summary for system records", () => {
    mount(
      <TrajectoryView
        records={[
          {
            id: "system:t1:1",
            kind: "system",
            turn: 1,
            step: 1,
            preview: "You are FlintLoom",
            output: "You are FlintLoom full",
            startedAt: 1_700_000_000_000,
          },
        ]}
      />,
    );
    const row = container?.querySelector('[data-trajectory-id="system:t1:1"]');
    expect(row?.textContent).toContain("SYSTEM");
    act(() => {
      (row as HTMLElement).click();
    });
    expect(container?.querySelector("[data-inspector-panel]")?.textContent).toContain(
      "You are FlintLoom full",
    );
    expect(container?.querySelector("[data-inspector-tab='timing']")).toBeTruthy();
    cleanup();
  });

  it("filters ledger by search and selects a row from the timeline", () => {
    mount(
      <TrajectoryView
        records={[
          {
            id: "system:t1:1",
            kind: "system",
            turn: 1,
            preview: "You are FlintLoom",
            output: "unique-sys-only",
            startedAt: 1000,
          },
          {
            id: "assistant:t1:1",
            kind: "assistant",
            turn: 1,
            preview: "hello",
            output: "hello",
            startedAt: 1100,
            timing: { llmMs: 80 },
          },
        ]}
      />,
    );
    const search = container?.querySelector('[aria-label="搜索轨迹"]') as HTMLInputElement;
    act(() => {
      const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      proto?.set?.call(search, "unique-sys-only");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container?.querySelector('[data-trajectory-id="assistant:t1:1"]')).toBeNull();
    expect(container?.querySelector('[data-trajectory-id="system:t1:1"]')).toBeTruthy();

    act(() => {
      const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      proto?.set?.call(search, "");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const span = container?.querySelector('[data-timeline-id="assistant:t1:1"]') as HTMLElement;
    act(() => {
      span.click();
    });
    expect(
      container?.querySelector('[data-trajectory-id="assistant:t1:1"]')?.getAttribute("aria-selected"),
    ).toBe("true");
    cleanup();
  });
});
