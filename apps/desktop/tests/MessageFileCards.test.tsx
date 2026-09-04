/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MessageFileCards } from "../src/MessageFileCards.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("MessageFileCards", () => {
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

  afterEach(() => {
    vi.unstubAllGlobals();
    cleanup();
  });

  it("does not show preview cards for mentioned names that are not workspace files", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            path: ".",
            entries: [{ name: "flintloom_capabilities.md", type: "file" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );
    mount(
      <MessageFileCards
        text={"对比一下 `version1.docx` 和 `version2.docx`，也可以打开 README.md。"}
        onOpenFile={() => undefined}
      />,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container?.querySelector(".chat-file-card")).toBeNull();
  });

  it("shows a preview card only for files that exist", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            path: ".",
            entries: [{ name: "README.md", type: "file" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );
    mount(
      <MessageFileCards
        text={"已写入 `README.md`，也可以参考 version1.docx。"}
        onOpenFile={() => undefined}
      />,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const cards = container?.querySelectorAll(".chat-file-card") ?? [];
    expect(cards).toHaveLength(1);
    expect(cards[0]?.textContent).toContain("README.md");
    expect(container?.textContent).not.toContain("version1.docx");
  });
});
