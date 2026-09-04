/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SettingsPane } from "../src/SettingsPane.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const emptySettings = {
  slots: [
    {
      id: "chat",
      label: "Chat / Omni",
      configured: false,
      source: "none",
    },
  ],
  webhook: { url: "http://127.0.0.1:7331/v1/hooks", hint: "token" },
};

function installSettingsFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes("/v1/settings/credentials")) {
        return new Response(JSON.stringify(emptySettings), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("{}", { status: 200 });
    }),
  );
}

async function waitForText(text: string) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (document.body.textContent?.includes(text)) return;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
  throw new Error(`missing text: ${text}`);
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("SettingsPane shell prefs", () => {
  let root: Root | undefined;
  let host: HTMLDivElement | undefined;

  beforeEach(() => {
    installSettingsFetch();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    host?.remove();
    vi.unstubAllGlobals();
    delete window.flintloom;
  });

  it("hides close-action when flintloom bridge is missing", async () => {
    await act(async () => {
      root!.render(<SettingsPane />);
    });
    await waitForText("Chat / Omni");
    expect(document.body.textContent).not.toContain("关闭窗口时");
  });

  it("shows close-action and writes prefs immediately", async () => {
    const getShellPrefs = vi.fn(async () => ({ closeAction: "ask" as const }));
    const setShellPrefs = vi.fn(async () => {});
    window.flintloom = {
      pickWorkspaceFolder: async () => undefined,
      openExternalUrl: async () => {},
      getShellPrefs,
      setShellPrefs,
    };
    await act(async () => {
      root!.render(<SettingsPane />);
    });
    await waitForText("关闭窗口时");
    const select = document.querySelector(
      "select[aria-label='关闭窗口时']",
    ) as HTMLSelectElement | null;
    if (!select) throw new Error("missing select");
    expect(select.value).toBe("ask");
    await act(async () => {
      select.value = "tray";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(setShellPrefs).toHaveBeenCalledWith({ closeAction: "tray" });
  });

  it("ignores an older failed save after a newer save succeeds", async () => {
    const firstSave = deferred<void>();
    const setShellPrefs = vi
      .fn()
      .mockImplementationOnce(() => firstSave.promise)
      .mockResolvedValueOnce(undefined);
    window.flintloom = {
      pickWorkspaceFolder: async () => undefined,
      openExternalUrl: async () => {},
      getShellPrefs: async () => ({ closeAction: "ask" }),
      setShellPrefs,
    };
    await act(async () => {
      root!.render(<SettingsPane />);
    });
    await waitForText("关闭窗口时");
    const select = document.querySelector(
      "select[aria-label='关闭窗口时']",
    ) as HTMLSelectElement | null;
    if (!select) throw new Error("missing select");

    await act(async () => {
      select.value = "tray";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(select.disabled).toBe(true);

    select.disabled = false;
    await act(async () => {
      select.value = "quit";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(setShellPrefs).toHaveBeenNthCalledWith(2, { closeAction: "quit" });

    await act(async () => {
      firstSave.reject(new Error("disk"));
      await firstSave.promise.catch(() => {});
    });
    expect(select.value).toBe("quit");
    expect(select.value).not.toBe("ask");
    expect(document.body.textContent).not.toContain("保存失败");
  });

  it("reverts and shows 保存失败 when setShellPrefs rejects", async () => {
    window.flintloom = {
      pickWorkspaceFolder: async () => undefined,
      openExternalUrl: async () => {},
      getShellPrefs: async () => ({ closeAction: "ask" }),
      setShellPrefs: async () => {
        throw new Error("disk");
      },
    };
    await act(async () => {
      root!.render(<SettingsPane />);
    });
    await waitForText("关闭窗口时");
    const select = document.querySelector(
      "select[aria-label='关闭窗口时']",
    ) as HTMLSelectElement | null;
    if (!select) throw new Error("missing select");
    await act(async () => {
      select.value = "quit";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await waitForText("保存失败");
    expect(select.value).toBe("ask");
  });
});
