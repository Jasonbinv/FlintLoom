/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { App } from "../src/App.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const HELLO_SSE =
  `data: {"type":"assistant/chunk","text":"hi"}\n\n` +
  `data: {"type":"assistant/message","text":"hello"}\n\n` +
  `data: {"type":"end","status":"ok"}\n\n`;

const ERROR_SSE =
  `data: {"type":"model/error","kind":"chat","message":"missing"}\n\n` +
  `data: {"type":"end","status":"failed"}\n\n`;

const DUP_USER_SSE =
  `data: {"type":"user/message","text":"from sse"}\n\n` +
  `data: {"type":"assistant/message","text":"hello"}\n\n` +
  `data: {"type":"end","status":"ok"}\n\n`;

function confirmMessages(surfaceId = "main") {
  return [
    {
      version: "v0.9" as const,
      createSurface: { surfaceId, catalogId: "flintloom:a2ui:core" },
    },
    {
      version: "v0.9" as const,
      updateComponents: {
        surfaceId,
        components: [
          { id: "root", component: "Column", children: ["title", "ok"] },
          { id: "title", component: "Text", text: "Continue?" },
          {
            id: "ok",
            component: "Button",
            child: "ok-label",
            action: { event: { name: "confirm" } },
          },
          { id: "ok-label", component: "Text", text: "OK" },
        ],
      },
    },
  ];
}

const ACTIONS_SSE =
  `data: {"type":"assistant/message","text":"after-click"}\n\n` +
  `data: {"type":"end","status":"ok"}\n\n`;

const SURFACE_SSE =
  `data: {"type":"turn/start","turnId":"t-wait"}\n\n` +
  `data: ${JSON.stringify({
    type: "a2ui/surface",
    turnId: "t-wait",
    surfaceId: "main",
    wait: true,
    messages: confirmMessages(),
  })}\n\n` + `data: {"type":"end","status":"awaiting_action"}\n\n`;

const GUARD_SSE =
  `data: {"type":"turn/start","turnId":"t-guard"}\n\n` +
  `data: ${JSON.stringify({
    type: "guard/ask",
    turnId: "t-guard",
    callId: "call-touch",
    tool: "touch",
    remainingCalls: [],
  })}\n\n` + `data: {"type":"end","status":"awaiting_action"}\n\n`;

const GUARD_ALLOW_SSE =
  `data: {"type":"tool/result","callId":"call-touch","name":"touch","text":"ok"}\n\n` +
  `data: {"type":"assistant/message","text":"done"}\n\n` +
  `data: {"type":"end","status":"ok"}\n\n`;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function installFetch(opts: {
  models?: Response | Error;
  session?: Response | Error;
  turn?: Response | Error;
  actions?: Response | Error;
  guard?: Response | Error;
  cancel?: Response | Error;
  files?: Response | Error;
  preview?: Response | Error;
  knowledge?: Response | Error;
  knowledgeSearch?: Response | Error;
  knowledgeImport?: Response | Error;
} = {}) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    if (url.includes("/v1/knowledge/search")) {
      if (opts.knowledgeSearch instanceof Error) throw opts.knowledgeSearch;
      return (
        opts.knowledgeSearch ??
        new Response(JSON.stringify({ hits: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    }
    if (url.includes("/v1/knowledge/import")) {
      if (opts.knowledgeImport instanceof Error) throw opts.knowledgeImport;
      return (
        opts.knowledgeImport ??
        new Response(
          JSON.stringify({
            id: 1,
            path: "README.md",
            title: "Hello",
            status: "ok",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      );
    }
    if (url.includes("/v1/knowledge")) {
      if (opts.knowledge instanceof Error) throw opts.knowledge;
      return (
        opts.knowledge ??
        new Response(
          JSON.stringify({
            items: [
              {
                id: 1,
                path: "notes/a.md",
                title: "Notes",
                status: "ok",
                ingestedAt: 1,
                current: true,
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      );
    }
    if (url.includes("/v1/files/preview")) {
      if (opts.preview instanceof Error) throw opts.preview;
      if (opts.preview) return opts.preview.clone();
      return new Response(
        JSON.stringify({
          path: "README.md",
          kind: "markdown",
          text: "# Hello\n",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.includes("/v1/files")) {
      if (opts.files instanceof Error) throw opts.files;
      if (opts.files) return opts.files.clone();
      return new Response(
        JSON.stringify({
          path: ".",
          entries: [{ name: "README.md", type: "file" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.includes("/v1/models")) {
      if (opts.models instanceof Error) throw opts.models;
      return (
        opts.models ??
        new Response(JSON.stringify([{ kind: "chat", configured: false }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    }
    if (url.includes("/v1/sessions/")) {
      if (opts.session instanceof Error) throw opts.session;
      return opts.session ?? new Response(null, { status: 404 });
    }
    if (url.includes("/cancel")) {
      if (opts.cancel instanceof Error) throw opts.cancel;
      return opts.cancel ?? new Response(null, { status: 200 });
    }
    if (url.includes("/actions")) {
      if (opts.actions instanceof Error) throw opts.actions;
      return (
        opts.actions ??
        new Response(ACTIONS_SSE, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })
      );
    }
    if (url.includes("/guard")) {
      if (opts.guard instanceof Error) throw opts.guard;
      return (
        opts.guard ??
        new Response(GUARD_ALLOW_SSE, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })
      );
    }
    if (url.includes("/v1/turns")) {
      if (opts.turn instanceof Error) throw opts.turn;
      return (
        opts.turn ??
        new Response(HELLO_SSE, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })
      );
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
}

async function mountApp() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<App />);
  });
}

async function waitForText(text: string, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (document.body.textContent?.includes(text)) return;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 15));
    });
  }
  throw new Error(
    `timed out waiting for ${JSON.stringify(text)}\n${document.body.textContent}`,
  );
}

async function typeAndSend(text: string) {
  const textarea = document.querySelector("textarea");
  if (!textarea) throw new Error("no textarea");
  await act(async () => {
    const proto = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    );
    proto?.set?.call(textarea, text);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const button = Array.from(document.querySelectorAll("button")).find(
    (b) => b.textContent === "发送",
  );
  if (!button) throw new Error("no send button");
  await act(async () => {
    button.click();
  });
}

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = undefined;
  container?.remove();
  container = undefined;
  vi.restoreAllMocks();
});

describe("App", () => {
  it("renders assistant hello from SSE fixture", async () => {
    installFetch({
      turn: new Response(HELLO_SSE, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    });
    await mountApp();
    await typeAndSend("hi");
    await waitForText("hello");
    expect(document.body.textContent).toContain("hello");
  });

  it("renders model/error message missing", async () => {
    installFetch({
      turn: new Response(ERROR_SSE, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    });
    await mountApp();
    await typeAndSend("hi");
    await waitForText("missing");
    expect(document.body.textContent).toContain("missing");
  });

  it("shows host unreachable when POST throws", async () => {
    installFetch({ turn: new Error("network") });
    await mountApp();
    await typeAndSend("hi");
    await waitForText("host unreachable");
    expect(document.body.textContent).toContain("host unreachable");
  });

  it("hydrates historical user/message from GET session", async () => {
    installFetch({
      session: new Response(
        JSON.stringify({
          events: [
            { type: "user/message", text: "past user" },
            { type: "assistant/message", text: "past assistant" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    });
    await mountApp();
    await waitForText("past user");
    expect(document.body.textContent).toContain("past user");
    expect(document.body.textContent).toContain("past assistant");
  });

  it("inserts optimistic user bubble and drops in-flight SSE user/message", async () => {
    installFetch({
      turn: new Response(DUP_USER_SSE, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    });
    await mountApp();
    await typeAndSend("typed locally");
    await waitForText("hello");
    expect(document.body.textContent).toContain("typed locally");
    expect(document.body.textContent).not.toContain("from sse");
  });

  it("truncates tool/call args and long tool/result", async () => {
    const args = { blob: "x".repeat(250) };
    const argsShown = JSON.stringify(args).slice(0, 200);
    const result = "r".repeat(2001);
    const toolSse =
      `data: ${JSON.stringify({ type: "tool/call", callId: "c1", name: "fs", args })}\n\n` +
      `data: ${JSON.stringify({ type: "tool/result", callId: "c1", name: "fs", text: result })}\n\n` +
      `data: ${JSON.stringify({ type: "end", status: "ok" })}\n\n`;
    installFetch({
      turn: new Response(toolSse, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    });
    await mountApp();
    await typeAndSend("use tool");
    await waitForText("fs");
    expect(document.body.textContent).toContain(argsShown);
    expect(document.body.textContent).not.toContain(JSON.stringify(args));
    expect(document.body.textContent).toContain(`${result.slice(0, 2000)}…`);
    expect(document.body.textContent).not.toContain(result);
  });

  it("shows file tree and preview and inserts path once", async () => {
    installFetch();
    await mountApp();
    await waitForText("README.md");
    await waitForText("Hello");
    expect(container!.textContent).toContain("README.md");
    expect(container!.textContent).toContain("Hello");

    const fileButton = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "README.md",
    );
    if (!fileButton) throw new Error("no README.md button");
    await act(async () => {
      fileButton.click();
    });
    const textarea = document.querySelector("textarea");
    if (!textarea) throw new Error("no textarea");
    expect(textarea.value).toBe("README.md");

    await act(async () => {
      fileButton.click();
    });
    expect(textarea.value).toBe("README.md");
  });

  it("renders infographic preview as an image without json source", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><text>Parse</text></svg>`;
    installFetch({
      files: new Response(
        JSON.stringify({
          path: ".",
          entries: [{ name: "flow.infographic.json", type: "file" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
      preview: new Response(
        JSON.stringify({
          path: "flow.infographic.json",
          kind: "svg",
          text: svg,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    });
    await mountApp();
    await waitForText("flow.infographic.json");
    const fileButton = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "flow.infographic.json",
    );
    if (!fileButton) throw new Error("no infographic button");
    await act(async () => {
      fileButton.click();
    });
    const img = document.querySelector("img");
    if (!img) throw new Error("no preview img");
    expect(img.getAttribute("alt")).toBe("flow.infographic.json");
    expect(img.getAttribute("src") ?? "").toContain("data:image/svg+xml");
    expect(img.getAttribute("src") ?? "").toContain(encodeURIComponent("<svg"));
    expect(document.querySelector("pre.file-preview")?.textContent ?? "").not.toContain(
      `"kind":"svg"`,
    );
    expect(document.body.textContent).not.toContain('"nodes"');
  });

  it("keeps root file tree when expanding a folder list fails", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.includes("/v1/files/preview")) {
        return new Response(
          JSON.stringify({
            path: "README.md",
            kind: "markdown",
            text: "# Hello\n",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/v1/files")) {
        const path = new URL(url, "http://local").searchParams.get("path");
        if (path === "." || path === null) {
          return new Response(
            JSON.stringify({
              path: ".",
              entries: [
                { name: "docs", type: "dir" },
                { name: "README.md", type: "file" },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        throw new Error("network");
      }
      if (url.includes("/v1/models")) {
        return new Response(JSON.stringify([{ kind: "chat", configured: false }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/v1/sessions/")) {
        return new Response(null, { status: 404 });
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;

    await mountApp();
    await waitForText("README.md");
    await waitForText("docs");

    const docsButton = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "docs",
    );
    if (!docsButton) throw new Error("no docs button");
    await act(async () => {
      docsButton.click();
    });
    await waitForText("host unreachable");
    expect(document.body.textContent).toContain("README.md");
    expect(document.body.textContent).toContain("docs");
  });

  it("shows Files and Knowledge tabs with Files default", async () => {
    installFetch();
    await mountApp();
    await waitForText("README.md");
    const filesTab = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "Files",
    );
    const knowledgeTab = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "Knowledge",
    );
    expect(filesTab).toBeTruthy();
    expect(knowledgeTab).toBeTruthy();
    expect(document.body.textContent).toContain("README.md");
  });

  it("loads knowledge list with Import disabled until a file is clicked", async () => {
    installFetch();
    await mountApp();
    await waitForText("README.md");
    const knowledgeTab = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "Knowledge",
    );
    if (!knowledgeTab) throw new Error("no Knowledge tab");
    await act(async () => {
      knowledgeTab.click();
    });
    await waitForText("notes/a.md");
    const importButton = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "Import",
    );
    if (!importButton) throw new Error("no Import button");
    expect(importButton.disabled).toBe(true);
  });

  it("imports selected file path after clicking a file", async () => {
    installFetch();
    await mountApp();
    await waitForText("README.md");

    const knowledgeTab = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "Knowledge",
    );
    const filesTab = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "Files",
    );
    if (!knowledgeTab || !filesTab) throw new Error("missing tabs");

    await act(async () => {
      knowledgeTab.click();
    });
    await waitForText("notes/a.md");

    await act(async () => {
      filesTab.click();
    });
    await waitForText("README.md");

    const fileButton = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "README.md",
    );
    if (!fileButton) throw new Error("no README.md button");
    await act(async () => {
      fileButton.click();
    });

    await act(async () => {
      knowledgeTab.click();
    });
    await waitForText("notes/a.md");

    const importButton = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "Import",
    );
    if (!importButton) throw new Error("no Import button");
    expect(importButton.disabled).toBe(false);
    await act(async () => {
      importButton.click();
    });

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const importCall = fetchMock.mock.calls.find(([input, init]) => {
      const url = requestUrl(input as RequestInfo | URL);
      return (
        url.includes("/v1/knowledge/import") &&
        (init as RequestInit | undefined)?.method === "POST"
      );
    });
    expect(importCall).toBeTruthy();
    const body = JSON.parse(String((importCall![1] as RequestInit).body)) as {
      path: string;
    };
    expect(body.path).toBe("README.md");
  });

  it("refreshes knowledge list (not search) after import when search had text", async () => {
    installFetch();
    await mountApp();
    await waitForText("README.md");

    const fileButton = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "README.md",
    );
    if (!fileButton) throw new Error("no README.md button");
    await act(async () => {
      fileButton.click();
    });

    const knowledgeTab = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "Knowledge",
    );
    if (!knowledgeTab) throw new Error("no Knowledge tab");
    await act(async () => {
      knowledgeTab.click();
    });
    await waitForText("notes/a.md");

    const searchInput = document.querySelector("input.knowledge-search");
    if (!searchInput) throw new Error("no knowledge search input");
    await act(async () => {
      const proto = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      );
      proto?.set?.call(searchInput, "foo");
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const importButton = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "Import",
    );
    if (!importButton) throw new Error("no Import button");
    expect(importButton.disabled).toBe(false);
    await act(async () => {
      importButton.click();
    });

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const importCallIdx = fetchMock.mock.calls.findIndex(([input, init]) => {
      const url = requestUrl(input as RequestInfo | URL);
      return (
        url.includes("/v1/knowledge/import") &&
        (init as RequestInit | undefined)?.method === "POST"
      );
    });
    expect(importCallIdx).toBeGreaterThanOrEqual(0);

    const callsAfterImport = fetchMock.mock.calls.slice(importCallIdx + 1);
    const listRefresh = callsAfterImport.find(([input, init]) => {
      const url = requestUrl(input as RequestInfo | URL);
      const method = (init as RequestInit | undefined)?.method ?? "GET";
      return (
        method === "GET" &&
        url.includes("/v1/knowledge") &&
        !url.includes("/search")
      );
    });
    expect(listRefresh).toBeTruthy();
  });

  it("shows host unreachable when knowledge fetch throws", async () => {
    installFetch({ knowledge: new Error("network") });
    await mountApp();
    await waitForText("README.md");
    const knowledgeTab = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "Knowledge",
    );
    if (!knowledgeTab) throw new Error("no Knowledge tab");
    await act(async () => {
      knowledgeTab.click();
    });
    await waitForText("host unreachable");
    expect(document.body.textContent).toContain("host unreachable");
  });

  it("keeps the later file preview when the first preview is delayed", async () => {
    let releaseStale: (() => void) | undefined;
    const staleGate = new Promise<void>((resolve) => {
      releaseStale = resolve;
    });

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.includes("/v1/files/preview")) {
        const path = new URL(url, "http://local").searchParams.get("path");
        const signal = init?.signal;
        if (path === "README.md") {
          await new Promise<void>((resolve, reject) => {
            const onAbort = () => {
              reject(new DOMException("The operation was aborted.", "AbortError"));
            };
            if (signal?.aborted) {
              onAbort();
              return;
            }
            signal?.addEventListener("abort", onAbort, { once: true });
            void staleGate.then(() => {
              signal?.removeEventListener("abort", onAbort);
              resolve();
            });
          });
          return new Response(
            JSON.stringify({
              path: "README.md",
              kind: "markdown",
              text: "STALE-PREVIEW-TEXT",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            path: "notes.txt",
            kind: "text",
            text: "FRESH-PREVIEW-TEXT",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/v1/files")) {
        return new Response(
          JSON.stringify({
            path: ".",
            entries: [
              { name: "README.md", type: "file" },
              { name: "notes.txt", type: "file" },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/v1/models")) {
        return new Response(JSON.stringify([{ kind: "chat", configured: false }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/v1/sessions/")) {
        return new Response(null, { status: 404 });
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;

    await mountApp();
    await waitForText("README.md");
    await waitForText("notes.txt");

    const notesButton = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "notes.txt",
    );
    if (!notesButton) throw new Error("no notes.txt button");
    await act(async () => {
      notesButton.click();
    });
    await waitForText("FRESH-PREVIEW-TEXT");

    await act(async () => {
      releaseStale?.();
      await new Promise((r) => setTimeout(r, 40));
    });

    expect(document.body.textContent).toContain("FRESH-PREVIEW-TEXT");
    expect(document.body.textContent).not.toContain("STALE-PREVIEW-TEXT");
  });

  it("renders a2ui surface and waits with send disabled and cancel visible", async () => {
    installFetch({
      turn: new Response(SURFACE_SSE, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    });
    await mountApp();
    await typeAndSend("hi");
    await waitForText("OK");
    const okButton = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "OK",
    );
    expect(okButton).toBeTruthy();
    const sendButton = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "发送",
    );
    expect(sendButton).toBeTruthy();
    expect(sendButton!.disabled).toBe(true);
    const cancelButton = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "取消",
    );
    expect(cancelButton).toBeTruthy();
  });

  it("posts confirm action to /actions with surfaceId main", async () => {
    installFetch({
      turn: new Response(SURFACE_SSE, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    });
    await mountApp();
    await typeAndSend("hi");
    await waitForText("OK");
    const okButton = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "OK",
    );
    if (!okButton) throw new Error("no OK button");
    await act(async () => {
      okButton.click();
    });
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const actionCall = fetchMock.mock.calls.find(([input, init]) => {
      const url = requestUrl(input as RequestInfo | URL);
      return (
        url.includes("/actions") &&
        (init as RequestInit | undefined)?.method === "POST"
      );
    });
    expect(actionCall).toBeTruthy();
    const body = JSON.parse(String((actionCall![1] as RequestInit).body)) as {
      name: string;
      surfaceId: string;
      data?: unknown;
    };
    expect(body.name).toBe("confirm");
    expect(body.surfaceId).toBe("main");
    expect(body.data).toEqual({});
  });

  it("posts /actions only once when OK is clicked twice in the same tick", async () => {
    installFetch({
      turn: new Response(SURFACE_SSE, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    });
    await mountApp();
    await typeAndSend("hi");
    await waitForText("OK");
    const okButton = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "OK",
    );
    if (!okButton) throw new Error("no OK button");
    await act(async () => {
      okButton.click();
      okButton.click();
    });
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const actionCalls = fetchMock.mock.calls.filter(([input, init]) => {
      const url = requestUrl(input as RequestInfo | URL);
      return (
        url.includes("/actions") &&
        (init as RequestInit | undefined)?.method === "POST"
      );
    });
    expect(actionCalls).toHaveLength(1);
  });

  it("renders guard ask with tool name only and disables send", async () => {
    installFetch({
      turn: new Response(GUARD_SSE, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    });
    await mountApp();
    await typeAndSend("run tool");
    await waitForText("touch");
    expect(document.body.textContent).toContain("允许执行工具");
    expect(document.body.textContent).not.toContain("call-touch");
    const sendButton = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "发送",
    );
    expect(sendButton?.disabled).toBe(true);
    const allowButton = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "允许",
    );
    expect(allowButton).toBeTruthy();
    const denyButton = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "拒绝",
    );
    expect(denyButton).toBeTruthy();
  });

  it("posts allow to /guard with callId", async () => {
    installFetch({
      turn: new Response(GUARD_SSE, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    });
    await mountApp();
    await typeAndSend("run tool");
    await waitForText("允许");
    const allowButton = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "允许",
    );
    if (!allowButton) throw new Error("no allow button");
    await act(async () => {
      allowButton.click();
    });
    await waitForText("done");
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const guardCall = fetchMock.mock.calls.find(([input, init]) => {
      const url = requestUrl(input as RequestInfo | URL);
      return (
        url.includes("/guard") &&
        (init as RequestInit | undefined)?.method === "POST"
      );
    });
    expect(guardCall).toBeTruthy();
    const body = JSON.parse(String((guardCall![1] as RequestInit).body)) as {
      callId: string;
      decision: string;
    };
    expect(body.callId).toBe("call-touch");
    expect(body.decision).toBe("allow");
  });

  it("posts deny to /guard when reject clicked", async () => {
    installFetch({
      turn: new Response(GUARD_SSE, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
      guard: new Response(
        `data: {"type":"tool/result","callId":"call-touch","name":"touch","text":"guard denied: touch"}\n\n` +
          `data: {"type":"end","status":"ok"}\n\n`,
        {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        },
      ),
    });
    await mountApp();
    await typeAndSend("run tool");
    await waitForText("拒绝");
    const denyButton = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "拒绝",
    );
    if (!denyButton) throw new Error("no deny button");
    await act(async () => {
      denyButton.click();
    });
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const guardCall = fetchMock.mock.calls.find(([input, init]) => {
      const url = requestUrl(input as RequestInfo | URL);
      return (
        url.includes("/guard") &&
        (init as RequestInit | undefined)?.method === "POST"
      );
    });
    expect(guardCall).toBeTruthy();
    const body = JSON.parse(String((guardCall![1] as RequestInit).body)) as {
      decision: string;
    };
    expect(body.decision).toBe("deny");
  });

  it("restores guard waiting state from session reload", async () => {
    installFetch({
      session: new Response(
        JSON.stringify({
          events: [
            { type: "turn/start", turnId: "t-guard" },
            {
              type: "guard/ask",
              turnId: "t-guard",
              callId: "call-touch",
              tool: "touch",
              remainingCalls: [],
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    });
    await mountApp();
    await waitForText("touch");
    const sendButton = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "发送",
    );
    expect(sendButton?.disabled).toBe(true);
  });

  it("button click posts the current picker value in data", async () => {
    const messages = [
      {
        version: "v0.9" as const,
        createSurface: { surfaceId: "main", catalogId: "flintloom:a2ui:core" },
      },
      {
        version: "v0.9" as const,
        updateDataModel: { surfaceId: "main", path: "/color", value: "red" },
      },
      {
        version: "v0.9" as const,
        updateComponents: {
          surfaceId: "main",
          components: [
            { id: "root", component: "Column", children: ["pick", "ok"] },
            {
              id: "pick",
              component: "ChoicePicker",
              options: [
                { label: "Red", value: "red" },
                { label: "Blue", value: "blue" },
              ],
              value: { path: "/color" },
            },
            {
              id: "ok",
              component: "Button",
              child: "ok-label",
              action: { event: { name: "confirm" } },
            },
            { id: "ok-label", component: "Text", text: "OK" },
          ],
        },
      },
    ];
    const sse =
      `data: {"type":"turn/start","turnId":"t-wait"}\n\n` +
      `data: ${JSON.stringify({
        type: "a2ui/surface",
        turnId: "t-wait",
        surfaceId: "main",
        wait: true,
        messages,
      })}\n\n` + `data: {"type":"end","status":"awaiting_action"}\n\n`;
    installFetch({
      turn: new Response(sse, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    });
    await mountApp();
    await typeAndSend("hi");
    await waitForText("OK");
    const select = document.querySelector("select");
    if (!select) throw new Error("no select");
    await act(async () => {
      const proto = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
      proto?.set?.call(select, "blue");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const okButton = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "OK",
    );
    if (!okButton) throw new Error("no OK button");
    await act(async () => {
      okButton.click();
    });
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const actionCall = fetchMock.mock.calls.find(([input, init]) => {
      const url = requestUrl(input as RequestInfo | URL);
      return (
        url.includes("/actions") &&
        (init as RequestInit | undefined)?.method === "POST"
      );
    });
    expect(actionCall).toBeTruthy();
    const body = JSON.parse(String((actionCall![1] as RequestInit).body)) as {
      name: string;
      data: { color?: string };
    };
    expect(body.name).toBe("confirm");
    expect(body.data.color).toBe("blue");
  });

  it("choice-picker-only posts name choice with the current value", async () => {
    const messages = [
      {
        version: "v0.9" as const,
        createSurface: { surfaceId: "main", catalogId: "flintloom:a2ui:core" },
      },
      {
        version: "v0.9" as const,
        updateDataModel: { surfaceId: "main", path: "/color", value: "red" },
      },
      {
        version: "v0.9" as const,
        updateComponents: {
          surfaceId: "main",
          components: [
            { id: "root", component: "Column", children: ["title", "pick"] },
            { id: "title", component: "Text", text: { path: "/color" } },
            {
              id: "pick",
              component: "ChoicePicker",
              options: [
                { label: "Red", value: "red" },
                { label: "Blue", value: "blue" },
              ],
              value: { path: "/color" },
            },
          ],
        },
      },
    ];
    const sse =
      `data: {"type":"turn/start","turnId":"t-wait"}\n\n` +
      `data: ${JSON.stringify({
        type: "a2ui/surface",
        turnId: "t-wait",
        surfaceId: "main",
        wait: true,
        messages,
      })}\n\n` + `data: {"type":"end","status":"awaiting_action"}\n\n`;
    installFetch({
      turn: new Response(sse, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    });
    await mountApp();
    await typeAndSend("hi");
    await waitForText("red");
    const start = Date.now();
    let actionCall: unknown[] | undefined;
    while (Date.now() - start < 2000) {
      const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
      actionCall = fetchMock.mock.calls.find(([input, init]) => {
        const url = requestUrl(input as RequestInfo | URL);
        return (
          url.includes("/actions") &&
          (init as RequestInit | undefined)?.method === "POST"
        );
      });
      if (actionCall) break;
      await act(async () => {
        await new Promise((r) => setTimeout(r, 15));
      });
    }
    expect(actionCall).toBeTruthy();
    const body = JSON.parse(String((actionCall![1] as RequestInit).body)) as {
      name: string;
      data: { color?: string };
    };
    expect(body.name).toBe("choice");
    expect(body.data.color).toBe("red");
  });

  it("keeps send disabled when cancel is not HTTP 200", async () => {
    installFetch({
      turn: new Response(SURFACE_SSE, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
      cancel: new Response(null, { status: 500 }),
    });
    await mountApp();
    await typeAndSend("hi");
    await waitForText("OK");
    const textarea = document.querySelector("textarea");
    if (!textarea) throw new Error("no textarea");
    await act(async () => {
      const proto = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      );
      proto?.set?.call(textarea, "next");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const sendButton = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "发送",
    );
    expect(sendButton?.disabled).toBe(true);
    const cancelButton = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "取消",
    );
    if (!cancelButton) throw new Error("no cancel");
    await act(async () => {
      cancelButton.click();
      await Promise.resolve();
    });
    expect(sendButton?.disabled).toBe(true);
  });

  it("shows empty log copy as a paragraph", async () => {
    installFetch();
    await mountApp();
    await waitForText("向工作区说一句话");
    const empty = document.querySelector(".log-empty");
    expect(empty).toBeTruthy();
    expect(empty?.tagName).toBe("P");
  });

  it("hides empty log copy after session hydrate", async () => {
    installFetch({
      session: new Response(
        JSON.stringify({
          events: [
            { type: "user/message", text: "past user" },
            { type: "assistant/message", text: "past assistant" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    });
    await mountApp();
    await waitForText("past user");
    expect(document.body.textContent).not.toContain("向工作区说一句话");
    expect(document.querySelector(".log-empty")).toBeNull();
  });

  it("renders warn pill when chat is not configured", async () => {
    installFetch();
    await mountApp();
    await waitForText("chat 未配置");
    expect(document.querySelector(".status-pill.warn")?.textContent).toBe(
      "chat 未配置",
    );
  });

  it("renders ok pill when chat is configured", async () => {
    installFetch({
      models: new Response(JSON.stringify([{ kind: "chat", configured: true }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    });
    await mountApp();
    await waitForText("chat 已配置");
    expect(document.querySelector(".status-pill.ok")?.textContent).toBe(
      "chat 已配置",
    );
  });

  it("renders down pill when models fetch fails", async () => {
    installFetch({ models: new Error("network") });
    await mountApp();
    await waitForText("host 未连接");
    expect(document.querySelector(".status-pill.down")?.textContent).toBe(
      "host 未连接",
    );
  });

  it("marks clicked file selected and never selects directories", async () => {
    installFetch({
      files: new Response(
        JSON.stringify({
          path: ".",
          entries: [
            { name: "docs", type: "dir" },
            { name: "README.md", type: "file" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    });
    await mountApp();
    await waitForText("README.md");
    await waitForText("docs");
    const readme = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "README.md",
    );
    const docs = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "docs",
    );
    if (!readme || !docs) throw new Error("missing tree buttons");
    expect(readme.classList.contains("selected")).toBe(false);
    await act(async () => {
      docs.click();
    });
    expect(docs.classList.contains("selected")).toBe(false);
    await act(async () => {
      readme.click();
    });
    expect(readme.classList.contains("selected")).toBe(true);
    expect(docs.classList.contains("selected")).toBe(false);
  });

  it("tags send as primary and cancel as ghost", async () => {
    installFetch({
      turn: new Response(SURFACE_SSE, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    });
    await mountApp();
    const send = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "发送",
    );
    expect(send?.classList.contains("btn-primary")).toBe(true);
    await typeAndSend("hi");
    await waitForText("OK");
    const cancel = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "取消",
    );
    expect(cancel?.classList.contains("btn-ghost")).toBe(true);
  });
});
