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
  plugins?: Response | Error;
  settings?: Response | Error;
  settingsPut?: Response | Error;
  settingsReload?: Response | Error;
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
  pluginInstall?: Response | Error;
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
    if (url.includes("/v1/settings/reload")) {
      if (opts.settingsReload instanceof Error) throw opts.settingsReload;
      return (
        opts.settingsReload ??
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    }
    if (url.includes("/v1/settings/workspace")) {
      if (init?.method === "POST") {
        const body = JSON.parse((init.body as string) ?? "{}") as {
          workspaceRoot?: string;
        };
        const workspaceRoot = body.workspaceRoot ?? "C:/workspace/new";
        return new Response(
          JSON.stringify({ workspaceRoot, ok: true }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ workspaceRoot: "C:/workspace/current" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.includes("/v1/settings/credentials/") && init?.method === "PUT") {
      if (opts.settingsPut instanceof Error) throw opts.settingsPut;
      return (
        opts.settingsPut ??
        new Response(JSON.stringify({ slot: { id: "media" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    }
    if (url.includes("/v1/settings/credentials")) {
      if (opts.settings instanceof Error) throw opts.settings;
      return (
        opts.settings ??
        new Response(
          JSON.stringify({
            slots: [
              {
                id: "chat",
                label: "Chat / Omni",
                configured: true,
                source: "env",
                maskedKey: "loca…cal",
              },
              {
                id: "media",
                label: "Media (ASR/TTS/…)",
                configured: false,
                source: "none",
              },
            ],
            webhook: {
              url: "http://127.0.0.1:7331/v1/hooks",
              hint: "Bearer hostToken",
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      );
    }
    if (url.includes("/v1/models")) {
      if (opts.models instanceof Error) throw opts.models;
      if (opts.models) return opts.models.clone();
      return new Response(JSON.stringify([{ kind: "chat", configured: false }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/v1/plugins/install") && init?.method === "POST") {
      if (opts.pluginInstall instanceof Error) throw opts.pluginInstall;
      return (
        opts.pluginInstall ??
        new Response(
          JSON.stringify({
            ok: true,
            id: "my-plugin",
            dest: "C:/Users/me/.flintloom/plugins/my-plugin",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      );
    }
    if (url.includes("/v1/plugins")) {
      if (opts.plugins instanceof Error) throw opts.plugins;
      if (opts.plugins) return opts.plugins.clone();
      return new Response(
        JSON.stringify([
          { id: "loop", name: "@flintloom/loop", status: "loaded" },
          { id: "tools", name: "@flintloom/tools", status: "loaded" },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
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
  const button = document.querySelector(".btn-send");
  if (!button) throw new Error("no send button");
  await act(async () => {
    button.click();
  });
}

function findNavTab(label: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll(".sidebar-nav button")).find((b) =>
    b.textContent?.includes(label),
  ) as HTMLButtonElement | undefined;
}

function findFileTreeButton(name: string): HTMLButtonElement | undefined {
  const label = Array.from(document.querySelectorAll(".file-label")).find(
    (el) => el.textContent === name,
  );
  return label?.closest("button") as HTMLButtonElement | undefined;
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
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

    const fileButton = findFileTreeButton("README.md");
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
    const fileButton = findFileTreeButton("flow.infographic.json");
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

    const docsButton = findFileTreeButton("docs");
    if (!docsButton) throw new Error("no docs button");
    await act(async () => {
      docsButton.click();
    });
    await waitForText("host unreachable");
    expect(document.body.textContent).toContain("README.md");
    expect(document.body.textContent).toContain("docs");
  });

  it("shows 文件 and 知识库 tabs with 文件 default", async () => {
    installFetch();
    await mountApp();
    await waitForText("README.md");
    const filesTab = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "文件",
    );
    const knowledgeTab = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "知识库",
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
      (b) => b.textContent === "知识库",
    );
    if (!knowledgeTab) throw new Error("no 知识库 tab");
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
      (b) => b.textContent === "知识库",
    );
    const filesTab = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "文件",
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

    const fileButton = findFileTreeButton("README.md");
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

    const fileButton = findFileTreeButton("README.md");
    if (!fileButton) throw new Error("no README.md button");
    await act(async () => {
      fileButton.click();
    });

    const knowledgeTab = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "知识库",
    );
    if (!knowledgeTab) throw new Error("no 知识库 tab");
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
      (b) => b.textContent === "知识库",
    );
    if (!knowledgeTab) throw new Error("no 知识库 tab");
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

    const notesButton = findFileTreeButton("notes.txt");
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
    const sendButton = document.querySelector(".btn-send") as HTMLButtonElement | null;
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
    const sendButton = document.querySelector(".btn-send") as HTMLButtonElement | null;
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
    const sendButton = document.querySelector(".btn-send") as HTMLButtonElement | null;
    expect(sendButton?.disabled).toBe(true);
  });

  it("hydrates guard/steward events from session", async () => {
    installFetch({
      session: new Response(
        JSON.stringify({
          events: [
            {
              type: "guard/steward",
              callId: "c1",
              tool: "fs",
              verdict: "suspicious",
              summary: "api key in output",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    });
    await mountApp();
    await waitForText("api key in output");
    expect(document.body.textContent).toContain("可疑");
  });

  it("hides guard steward bubble when verdict is ok and summary is empty", async () => {
    installFetch({
      session: new Response(
        JSON.stringify({
          events: [
            {
              type: "guard/steward",
              callId: "c1",
              tool: "fs",
              verdict: "ok",
              summary: "",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    });
    await mountApp();
    expect(document.querySelector(".guard-steward")).toBeNull();
  });

  it("shows guard steward bubble when verdict is ok but summary is non-empty", async () => {
    installFetch({
      session: new Response(
        JSON.stringify({
          events: [
            {
              type: "guard/steward",
              callId: "c1",
              tool: "fs",
              verdict: "ok",
              summary: "large output",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    });
    await mountApp();
    await waitForText("large output");
    expect(document.querySelector(".guard-steward")).toBeTruthy();
    expect(document.body.textContent).toContain("复查");
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
    const sendButton = document.querySelector(".btn-send") as HTMLButtonElement | null;
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
    await waitForText("今天我能帮你做什么？");
    const empty = document.querySelector(".log-empty");
    expect(empty).toBeTruthy();
    expect(empty?.tagName).toBe("DIV");
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
    expect(document.body.textContent).not.toContain("今天我能帮你做什么？");
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

  it("renders guard pill in sidebar when guard is configured", async () => {
    installFetch({
      models: new Response(
        JSON.stringify([
          { kind: "chat", configured: true },
          { kind: "guard", configured: true },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    });
    await mountApp();
    await waitForText("guard 已配置");
    const pills = Array.from(document.querySelectorAll(".sidebar-status .status-pill.ok"));
    expect(pills.some((pill) => pill.textContent === "guard 已配置")).toBe(true);
  });

  it("cycles theme on toggle button click", async () => {
    localStorage.setItem("flintloom.theme", "light");
    await mountApp();
    const toggle = document.querySelector(".theme-toggle") as HTMLButtonElement;
    expect(toggle).toBeTruthy();
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(toggle.textContent).toContain("浅色");
    await act(async () => {
      toggle.click();
    });
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("flintloom.theme")).toBe("dark");
    expect(toggle.textContent).toContain("深色");
    await act(async () => {
      toggle.click();
    });
    expect(document.documentElement.getAttribute("data-theme")).toBe("warm");
    expect(toggle.textContent).toContain("暖色");
    await act(async () => {
      toggle.click();
    });
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
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
    const readme = findFileTreeButton("README.md");
    const docs = findFileTreeButton("docs");
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
    const send = document.querySelector(".btn-send");
    expect(send?.classList.contains("btn-send")).toBe(true);
    await typeAndSend("hi");
    await waitForText("OK");
    const cancel = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "取消",
    );
    expect(cancel?.classList.contains("composer-tool-btn")).toBe(true);
  });

  it("shows plugin list on Plugins page", async () => {
    installFetch({
      plugins: new Response(
        JSON.stringify([
          { id: "loop", name: "@flintloom/loop", status: "loaded" },
          { id: "fake", name: "@flintloom/mcp", status: "loaded" },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    });
    await mountApp();
    const pluginsTab = findNavTab("插件");
    if (!pluginsTab) throw new Error("no 插件 tab");
    await act(async () => {
      pluginsTab.click();
    });
    await waitForText("@flintloom/loop");
    expect(document.body.textContent).toContain("loop");
    expect(document.body.textContent).toContain("loaded");
    expect(document.querySelector(".plugin-tag.mcp")).toBeTruthy();
    expect(document.body.textContent).toContain("mcp-servers.yml");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("shows model kinds on Models page", async () => {
    installFetch({
      models: new Response(
        JSON.stringify([
          { kind: "chat", configured: true, defaultId: "default" },
          { kind: "asr", configured: false, defaultId: null },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    });
    await mountApp();
    const modelsTab = findNavTab("模型");
    if (!modelsTab) throw new Error("no 模型 tab");
    await act(async () => {
      modelsTab.click();
    });
    await waitForText("asr");
    expect(document.body.textContent).toContain("default");
    expect(document.body.textContent).toContain("flintloom.yml");
    expect(document.querySelector(".settings-table")).toBeTruthy();
  });

  it("shows guard configured status on Models page", async () => {
    installFetch({
      models: new Response(
        JSON.stringify([
          { kind: "chat", configured: true, defaultId: "default" },
          { kind: "guard", configured: true, defaultId: "default" },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    });
    await mountApp();
    const modelsTab = findNavTab("模型");
    if (!modelsTab) throw new Error("no 模型 tab");
    await act(async () => {
      modelsTab.click();
    });
    await waitForText("guard 已配置");
    expect(document.querySelector(".models-kind-status .status-pill.ok")).toBeTruthy();
  });

  it("shows guard not configured on Models page", async () => {
    installFetch({
      models: new Response(
        JSON.stringify([
          { kind: "chat", configured: true, defaultId: "default" },
          { kind: "guard", configured: false, defaultId: null },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    });
    await mountApp();
    const modelsTab = findNavTab("模型");
    if (!modelsTab) throw new Error("no 模型 tab");
    await act(async () => {
      modelsTab.click();
    });
    await waitForText("guard 未配置");
    expect(document.querySelector(".models-kind-status .status-pill.warn")).toBeTruthy();
  });

  it("shows media kind pills on Models page", async () => {
    installFetch({
      models: new Response(
        JSON.stringify([
          { kind: "chat", configured: true, defaultId: "default" },
          { kind: "asr", configured: true, defaultId: "default" },
          { kind: "tts", configured: false, defaultId: null },
          { kind: "omni", configured: true, defaultId: "default" },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    });
    await mountApp();
    const modelsTab = findNavTab("模型");
    if (!modelsTab) throw new Error("no 模型 tab");
    await act(async () => {
      modelsTab.click();
    });
    await waitForText("asr 已配置");
    expect(document.body.textContent).toContain("tts 未配置");
    expect(document.body.textContent).toContain("omni 已配置");
  });

  it("shows image button when omni is configured", async () => {
    installFetch({
      models: new Response(
        JSON.stringify([
          { kind: "chat", configured: true, defaultId: "default" },
          { kind: "omni", configured: true, defaultId: "default" },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    });
    await mountApp();
    await waitForText("图片");
    expect(
      Array.from(document.querySelectorAll("button")).some((btn) => btn.textContent === "图片"),
    ).toBe(true);
  });

  it("hides image button when omni is not configured", async () => {
    installFetch({
      models: new Response(
        JSON.stringify([{ kind: "chat", configured: true, defaultId: "default" }]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    });
    await mountApp();
    await waitForText("chat 已配置");
    expect(
      Array.from(document.querySelectorAll("button")).some((btn) => btn.textContent === "图片"),
    ).toBe(false);
  });

  it("shows voice button when asr is configured", async () => {
    installFetch({
      models: new Response(
        JSON.stringify([
          { kind: "chat", configured: true, defaultId: "default" },
          { kind: "asr", configured: true, defaultId: "default" },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    });
    await mountApp();
    await waitForText("语音");
    expect(
      Array.from(document.querySelectorAll("button")).some((btn) => btn.textContent === "语音"),
    ).toBe(true);
  });

  it("hides voice button when asr is not configured", async () => {
    installFetch({
      models: new Response(
        JSON.stringify([{ kind: "chat", configured: true, defaultId: "default" }]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    });
    await mountApp();
    await waitForText("chat 已配置");
    expect(
      Array.from(document.querySelectorAll("button")).some((btn) => btn.textContent === "语音"),
    ).toBe(false);
  });

  it("shows tts play button on assistant messages when tts is configured", async () => {
    installFetch({
      models: new Response(
        JSON.stringify([
          { kind: "chat", configured: true, defaultId: "default" },
          { kind: "tts", configured: true, defaultId: "default" },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
      session: new Response(
        JSON.stringify({
          events: [{ type: "assistant/message", text: "hello world" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    });
    await mountApp();
    await waitForText("hello world");
    expect(document.querySelector(".bubble-tts")).toBeTruthy();
    expect(document.body.textContent).toContain("朗读");
  });

  it("hides tts play button when tts is not configured", async () => {
    installFetch({
      models: new Response(
        JSON.stringify([{ kind: "chat", configured: true, defaultId: "default" }]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
      session: new Response(
        JSON.stringify({
          events: [{ type: "assistant/message", text: "hello world" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    });
    await mountApp();
    await waitForText("hello world");
    expect(document.querySelector(".bubble-tts")).toBeNull();
  });

  it("shows embedding and rerank pills on Models page", async () => {
    installFetch({
      models: new Response(
        JSON.stringify([
          { kind: "chat", configured: true, defaultId: "default" },
          { kind: "embedding", configured: true, defaultId: "default" },
          { kind: "rerank", configured: false, defaultId: null },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    });
    await mountApp();
    const modelsTab = findNavTab("模型");
    if (!modelsTab) throw new Error("no 模型 tab");
    await act(async () => {
      modelsTab.click();
    });
    await waitForText("embedding 已配置");
    expect(document.body.textContent).toContain("rerank 未配置");
    expect(document.body.textContent).toContain("向量相似度");
  });

  it("renders Settings page with credential slots", async () => {
    installFetch();
    await mountApp();
    const settingsTab = findNavTab("设置");
    if (!settingsTab) throw new Error("no 设置 tab");
    await act(async () => {
      settingsTab.click();
    });
    await waitForText("Chat / Omni");
    expect(document.body.textContent).toContain("来自 .env");
    expect(document.body.textContent).toContain("loca…cal");
    expect(document.body.textContent).toContain("/v1/hooks");
    expect(document.body.textContent).toContain("插件安装");
    expect(document.body.textContent).toContain("个人微信桥接");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("renders WeCom channel fields on Settings page", async () => {
    installFetch({
      settings: new Response(
        JSON.stringify({
          slots: [
            {
              id: "chat",
              label: "Chat / Omni",
              configured: true,
              source: "env",
              maskedKey: "loca…cal",
            },
            {
              id: "wecom",
              label: "企业微信",
              configured: true,
              source: "credentials",
              appId: "ww_test",
              agentId: "1000002",
              callbackUrl: "http://127.0.0.1:7331/v1/channels/wecom/callback",
            },
          ],
          webhook: {
            url: "http://127.0.0.1:7331/v1/hooks",
            hint: "Bearer hostToken",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    });
    await mountApp();
    const settingsTab = findNavTab("设置");
    if (!settingsTab) throw new Error("no 设置 tab");
    await act(async () => {
      settingsTab.click();
    });
    await waitForText("企业微信");
    expect(document.body.textContent).toContain("Corp ID");
    expect(document.body.textContent).toContain("Callback Token");
    expect(document.body.textContent).toContain("/v1/channels/wecom/callback");
  });

  it("installs plugin from Settings page", async () => {
    installFetch();
    await mountApp();
    const settingsTab = findNavTab("设置");
    if (!settingsTab) throw new Error("no 设置 tab");
    await act(async () => {
      settingsTab.click();
    });
    await waitForText("插件安装");
    const pathInput = document.querySelector(
      'input[placeholder="G:/path/to/my-plugin"]',
    ) as HTMLInputElement | null;
    if (!pathInput) throw new Error("no plugin path input");
    await act(async () => {
      const proto = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      );
      proto?.set?.call(pathInput, "G:/plugins/demo");
      pathInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const installBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "安装插件",
    );
    if (!installBtn) throw new Error("no 安装插件 button");
    await act(async () => {
      installBtn.click();
    });
    await waitForText("已安装插件 my-plugin 并重载 host");
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const installCall = fetchMock.mock.calls.find(
      (c) =>
        String(c[0]).includes("/v1/plugins/install") &&
        (c[1] as RequestInit | undefined)?.method === "POST",
    );
    expect(installCall).toBeTruthy();
    const body = JSON.parse((installCall![1] as RequestInit).body as string) as {
      sourcePath: string;
    };
    expect(body.sourcePath).toBe("G:/plugins/demo");
  });

  it("Models page links to Settings", async () => {
    installFetch();
    await mountApp();
    const modelsTab = findNavTab("模型");
    if (!modelsTab) throw new Error("no 模型 tab");
    await act(async () => {
      modelsTab.click();
    });
    await waitForText("flintloom.yml");
    const settingsLink = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "设置" && b.classList.contains("linkish"),
    );
    if (!settingsLink) throw new Error("no 设置 link on Models page");
    await act(async () => {
      settingsLink.click();
    });
    await waitForText("Chat / Omni");
    expect(document.body.textContent).toContain("Providers");
  });

  it("renders a2ui DataTable and Chart without pausing turn", async () => {
    const messages = [
      {
        version: "v0.9" as const,
        createSurface: { surfaceId: "main", catalogId: "flintloom:a2ui:core" },
      },
      {
        version: "v0.9" as const,
        updateComponents: {
          surfaceId: "main",
          components: [
            { id: "root", component: "Column", children: ["tbl", "chart"] },
            {
              id: "tbl",
              component: "DataTable",
              headers: ["item", "count"],
              rows: [["apple", "3"]],
            },
            {
              id: "chart",
              component: "Chart",
              kind: "bar",
              labels: ["Q1", "Q2"],
              values: [2, 5],
            },
          ],
        },
      },
    ];
    const sse =
      `data: {"type":"turn/start","turnId":"t-show"}\n\n` +
      `data: ${JSON.stringify({
        type: "a2ui/surface",
        turnId: "t-show",
        surfaceId: "main",
        wait: false,
        messages,
      })}\n\n` +
      `data: {"type":"assistant/message","text":"shown"}\n\n` +
      `data: {"type":"end","status":"ok"}\n\n`;
    installFetch({
      turn: new Response(sse, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    });
    await mountApp();
    await typeAndSend("show data");
    await waitForText("apple");
    expect(document.querySelector(".a2ui-table")).toBeTruthy();
    expect(document.querySelector(".a2ui-chart-svg")).toBeTruthy();
    expect(
      Array.from(document.querySelectorAll("button")).some((b) => b.textContent === "取消"),
    ).toBe(false);
  });

  it("renders a2ui Infographic from inline document", async () => {
    const messages = [
      {
        version: "v0.9" as const,
        createSurface: { surfaceId: "main", catalogId: "flintloom:a2ui:core" },
      },
      {
        version: "v0.9" as const,
        updateComponents: {
          surfaceId: "main",
          components: [
            {
              id: "root",
              component: "Infographic",
              document: {
                nodes: [{ id: "n1", label: "HelloNode", x: 40, y: 30 }],
                edges: [],
              },
            },
          ],
        },
      },
    ];
    const sse =
      `data: {"type":"turn/start","turnId":"t-ig"}\n\n` +
      `data: ${JSON.stringify({
        type: "a2ui/surface",
        turnId: "t-ig",
        surfaceId: "main",
        wait: false,
        messages,
      })}\n\n` +
      `data: {"type":"end","status":"ok"}\n\n`;
    installFetch({
      turn: new Response(sse, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    });
    await mountApp();
    await typeAndSend("show ig");
    await waitForText("HelloNode");
    expect(document.querySelector(".a2ui-infographic svg")).toBeTruthy();
  });

  it("adds sent message to sidebar session list", async () => {
    installFetch({
      turn: new Response(HELLO_SSE, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    });
    await mountApp();
    await typeAndSend("plan the sprint");
    await waitForText("hello");
    const item = Array.from(document.querySelectorAll(".sidebar-history-item")).find(
      (el) => el.textContent === "plan the sprint",
    );
    expect(item).toBeTruthy();
    expect(item?.classList.contains("active")).toBe(true);
  });

  it("renders file cards in assistant messages and opens preview on click", async () => {
    const FILE_SSE =
      `data: {"type":"assistant/message","text":"已生成 README.md，请查看。"}\n\n` +
      `data: {"type":"end","status":"ok"}\n\n`;
    installFetch({
      turn: new Response(FILE_SSE, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    });
    await mountApp();
    await typeAndSend("write readme");
    await waitForText("README.md");
    const card = document.querySelector(".chat-file-card");
    expect(card).toBeTruthy();
    expect(card?.textContent).toContain("README.md");
    await act(async () => {
      card?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await waitForText("# Hello");
    const preview = document.querySelector(".file-preview");
    expect(preview?.textContent).toContain("# Hello");
  });

  it("deletes a session from sidebar task list", async () => {
    const SESSION_A = "11111111-1111-1111-1111-111111111111";
    const SESSION_B = "22222222-2222-2222-2222-222222222222";
    sessionStorage.setItem("flintloom.sessionId", SESSION_A);
    localStorage.setItem(
      "flintloom.sessions",
      JSON.stringify([
        { id: SESSION_A, title: "Keep me", updatedAt: 2 },
        { id: SESSION_B, title: "Delete me", updatedAt: 1 },
      ]),
    );
    installFetch({});
    await mountApp();
    const deleteBtn = Array.from(document.querySelectorAll(".sidebar-history-delete")).find(
      (el) => el.getAttribute("aria-label") === "删除任务 Delete me",
    ) as HTMLButtonElement;
    expect(deleteBtn).toBeTruthy();
    await act(async () => {
      deleteBtn.click();
    });
    expect(document.body.textContent).not.toContain("Delete me");
    expect(document.body.textContent).toContain("Keep me");
    expect(JSON.parse(localStorage.getItem("flintloom.sessions") ?? "[]")).toHaveLength(1);
  });

  it("switches between persisted sessions from sidebar", async () => {
    const SESSION_A = "11111111-1111-1111-1111-111111111111";
    const SESSION_B = "22222222-2222-2222-2222-222222222222";
    sessionStorage.setItem("flintloom.sessionId", SESSION_A);
    localStorage.setItem(
      "flintloom.sessions",
      JSON.stringify([
        { id: SESSION_A, title: "First task", updatedAt: 1 },
        { id: SESSION_B, title: "Second task", updatedAt: 2 },
      ]),
    );
    installFetch({});
    const baseFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input);
        if (url.includes("/v1/sessions/")) {
          if (url.includes(SESSION_A)) {
            return new Response(
              JSON.stringify({
                events: [
                  { type: "user/message", text: "First task" },
                  { type: "assistant/message", text: "reply A" },
                ],
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }
          if (url.includes(SESSION_B)) {
            return new Response(
              JSON.stringify({
                events: [
                  { type: "user/message", text: "Second task" },
                  { type: "assistant/message", text: "reply B" },
                ],
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }
          return new Response(null, { status: 404 });
        }
        return baseFetch(input, init);
      }) as typeof fetch,
    );
    await mountApp();
    await waitForText("reply A");
    const second = Array.from(
      document.querySelectorAll(".sidebar-history-item"),
    ).find((el) => el.textContent === "Second task") as HTMLButtonElement;
    expect(second).toBeTruthy();
    await act(async () => {
      second.click();
    });
    await waitForText("reply B");
    expect(document.body.textContent).not.toContain("reply A");
    expect(second.classList.contains("active")).toBe(true);
  });

  it("switches workspace from recent list without prompt", async () => {
    localStorage.setItem(
      "flintloom.workspace.recent",
      JSON.stringify([
        { path: "C:/workspace/current", updatedAt: 2 },
        { path: "C:/workspace/other", updatedAt: 1 },
      ]),
    );
    installFetch();
    await mountApp();
    await waitForText("最近");
    const recentBtn = Array.from(
      document.querySelectorAll(".workspace-recent-item"),
    ).find((el) => el.textContent?.includes("other")) as HTMLButtonElement;
    expect(recentBtn).toBeTruthy();
    await act(async () => {
      recentBtn.click();
    });
    await waitForText("工作区已切换");
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const switchCall = fetchMock.mock.calls.find(
      (c) =>
        String(c[0]).includes("/v1/settings/workspace") &&
        (c[1] as RequestInit | undefined)?.method === "POST",
    );
    expect(switchCall).toBeTruthy();
    const body = JSON.parse((switchCall![1] as RequestInit).body as string) as {
      workspaceRoot: string;
    };
    expect(body.workspaceRoot).toBe("C:/workspace/other");
    const recent = JSON.parse(
      localStorage.getItem("flintloom.workspace.recent") ?? "[]",
    ) as { path: string }[];
    expect(recent[0]?.path).toBe("C:/workspace/other");
  });
});
