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

function hangUntilAbort(signal?: AbortSignal): Promise<Response> {
  return new Promise((_resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    signal?.addEventListener(
      "abort",
      () => {
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
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
  listRootEntries?: () => Array<{ name: string; type: "file" | "dir" }>;
  filesSync?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
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
    if (url.includes("/v1/files/safe-html/open")) {
      return new Response(
        JSON.stringify({
          openUrl: "http://127.0.0.1:7331/v1/files/safe-html?t=test-token",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.includes("/v1/files/markdown")) {
      return new Response(
        JSON.stringify({ path: "report.pdf", markdown: "# Title\n" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.includes("/v1/files/from-markdown")) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/v1/files/convert")) {
      return new Response(
        JSON.stringify({
          ok: true,
          source: "README.md",
          out: "README.html",
          format: "html",
          loss: "images skipped; emphasis flattened",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.includes("/v1/files/raw")) {
      if (init?.method === "PUT") {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("spreadsheet-bytes", {
        status: 200,
        headers: { "Content-Type": "application/octet-stream" },
      });
    }
    if (
      url.includes("/v1/files/mkdir") ||
      url.includes("/v1/files/create") ||
      url.includes("/v1/files/rename") ||
      (url.includes("/v1/files") && init?.method === "DELETE")
    ) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
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
    if (url.includes("/v1/files/sync")) {
      if (opts.filesSync) return opts.filesSync(input, init);
      return hangUntilAbort(init?.signal);
    }
    if (url.includes("/v1/files")) {
      if (opts.files instanceof Error) throw opts.files;
      const path = new URL(url, "http://local").searchParams.get("path");
      const isRoot = path === null || path === "" || path === ".";
      if (!isRoot) {
        return new Response(
          JSON.stringify({ path, entries: [] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (opts.listRootEntries) {
        return new Response(
          JSON.stringify({ path: ".", entries: opts.listRootEntries() }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
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

function fileListOf(files: File[]): FileList {
  const list = Object.assign([...files], {
    item: (index: number) => files[index] ?? null,
  });
  return list as unknown as FileList;
}

async function clickFileTreeItem(name: string): Promise<HTMLButtonElement> {
  const fileButton = findFileTreeButton(name);
  if (!fileButton) throw new Error(`no ${name} button`);
  await act(async () => {
    fileButton.click();
  });
  return fileButton;
}

function fireContextMenu(el: Element, clientX = 48, clientY = 96) {
  el.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
    }),
  );
}

function findContextMenuItem(label: string): HTMLButtonElement | undefined {
  return Array.from(
    document.querySelectorAll(".file-tree-context-menu button"),
  ).find((b) => b.textContent === label) as HTMLButtonElement | undefined;
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

  it("renders completed assistant markdown as formatted html", async () => {
    const sse =
      `data: ${JSON.stringify({
        type: "assistant/message",
        text: "### 架构层面的原因\n\n- 文本通道\n- 渲染通道",
      })}\n\n` + `data: {"type":"end","status":"ok"}\n\n`;
    installFetch({
      turn: new Response(sse, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    });
    await mountApp();
    await typeAndSend("explain");
    await waitForText("架构层面的原因");
    expect(document.querySelector(".assistant-md h3")?.textContent).toContain("架构层面的原因");
    expect(document.querySelector(".assistant-md li")?.textContent).toContain("文本通道");
    expect(document.body.textContent).not.toContain("### 架构层面的原因");
  });

  it("renders streaming assistant draft as markdown including tables", async () => {
    const tableChunk =
      "### 已知技能列表\n\n| 技能 | 描述 |\n|:---|:---|\n| report-a2ui | A2UI |\n";
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "assistant/chunk", text: tableChunk })}\n\n`,
          ),
        );
      },
    });
    installFetch({
      turn: new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    });
    await mountApp();
    await typeAndSend("list skills");
    await waitForText("已知技能列表");
    expect(document.querySelector(".bubble.draft .assistant-md h3")?.textContent).toContain(
      "已知技能列表",
    );
    expect(document.querySelector(".bubble.draft .assistant-md table")?.textContent).toContain(
      "report-a2ui",
    );
    expect(document.body.textContent).not.toContain("|:---|");
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

  it("shows tool call row with truncated result in expanded body", async () => {
    const args = { blob: "x".repeat(250) };
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
    await waitForText("File");
    const toolHeader = document.querySelector(".tool-row .disclosure-row-header");
    if (!toolHeader) throw new Error("no tool row");
    await act(async () => {
      (toolHeader as HTMLButtonElement).click();
    });
    expect(document.body.textContent).toContain(`${result.slice(0, 2000)}…`);
    expect(document.body.textContent).not.toContain(result);
  });

  it("groups consecutive tool steps under one AI turn", async () => {
    const toolSse =
      `data: ${JSON.stringify({ type: "tool/call", callId: "c1", name: "doc_generate", args: {} })}\n\n` +
      `data: ${JSON.stringify({ type: "tool/result", callId: "c1", name: "doc_generate", text: "failed: not found" })}\n\n` +
      `data: ${JSON.stringify({ type: "tool/call", callId: "c2", name: "fs", args: { action: "list" } })}\n\n` +
      `data: ${JSON.stringify({ type: "tool/result", callId: "c2", name: "fs", text: "ok" })}\n\n` +
      `data: ${JSON.stringify({ type: "end", status: "ok" })}\n\n`;
    installFetch({
      turn: new Response(toolSse, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    });
    await mountApp();
    await typeAndSend("做一个word示例");
    await waitForText("File");
    expect(document.querySelectorAll(".log > .message-tool-step")).toHaveLength(1);
    expect(document.querySelectorAll(".log > .message-tool-step .tool-row")).toHaveLength(2);
    expect(document.querySelectorAll(".log > .message-tool-step .message-avatar")).toHaveLength(1);
  });

  it("does not auto-open file preview and docks it beside the tree", async () => {
    installFetch();
    await mountApp();
    await waitForText("README.md");
    expect(document.querySelector(".file-preview-surface")).toBeNull();
    const rail = document.querySelector(".file-pane-rail") as HTMLElement | null;
    const closedWidth = Number.parseFloat(rail?.style.width ?? "0");

    await clickFileTreeItem("README.md");
    await waitForText("Hello");
    expect(document.querySelector(".file-preview-surface")).toBeTruthy();
    expect(document.querySelector(".file-pane-shell--previewing")).toBeTruthy();
    expect(document.querySelector(".file-tree-surface")).toBeTruthy();

    const tree = document.querySelector(".file-tree-surface") as HTMLElement | null;
    expect(tree?.style.height).toBe("");
    expect(
      document
        .querySelector(".file-pane-inner-split-handle")
        ?.getAttribute("aria-orientation"),
    ).toBe("vertical");
    expect(Number.parseFloat(rail?.style.width ?? "0")).toBeGreaterThan(closedWidth);
  });

  it("shows file tree and preview without inserting path on click", async () => {
    installFetch();
    await mountApp();
    await waitForText("README.md");
    expect(container!.textContent).toContain("README.md");
    expect(document.querySelector(".file-preview-surface")).toBeNull();

    const textarea = document.querySelector("textarea");
    if (!textarea) throw new Error("no textarea");
    expect(textarea.value).toBe("");

    await clickFileTreeItem("README.md");
    await waitForText("Hello");
    expect(textarea.value).toBe("");
    expect(document.querySelector(".file-preview-surface")).toBeTruthy();

    const quoteButton = Array.from(
      document.querySelectorAll(".file-preview-header__action"),
    ).find((btn) => btn.textContent === "引用") as HTMLButtonElement | undefined;
    if (!quoteButton) {
      throw new Error("no quote button");
    }
    await act(async () => {
      quoteButton.click();
    });
    expect(textarea.value).toBe("");
    const chips = document.querySelectorAll(".composer-attach-chip");
    expect(chips).toHaveLength(1);
    expect(chips[0]?.textContent).toContain("README.md");
    expect(document.querySelector('[aria-label="待发送附件"]')).toBeTruthy();

    await act(async () => {
      quoteButton.click();
    });
    expect(textarea.value).toBe("");
    expect(document.querySelectorAll(".composer-attach-chip")).toHaveLength(1);
  });

  it("closes file preview with the header close button", async () => {
    installFetch();
    await mountApp();
    await waitForText("README.md");
    await clickFileTreeItem("README.md");
    await waitForText("Hello");
    expect(document.querySelector(".file-preview-surface")).toBeTruthy();

    const closeBtn = document.querySelector(
      ".file-preview-header__close",
    ) as HTMLButtonElement | null;
    if (!closeBtn) throw new Error("no preview close button");
    await act(async () => {
      closeBtn.click();
    });

    expect(document.querySelector(".file-preview-surface")).toBeNull();
    const fileButton = findFileTreeButton("README.md");
    if (!fileButton) throw new Error("no README.md button");
    expect(fileButton.getAttribute("aria-selected")).not.toBe("true");
  });

  it("reopens file preview after closing", async () => {
    installFetch();
    await mountApp();
    await waitForText("README.md");
    await clickFileTreeItem("README.md");
    await waitForText("Hello");

    const closeBtn = document.querySelector(
      ".file-preview-header__close",
    ) as HTMLButtonElement | null;
    if (!closeBtn) throw new Error("no preview close button");
    await act(async () => {
      closeBtn.click();
    });
    expect(document.querySelector(".file-preview-surface")).toBeNull();

    const fileButton = findFileTreeButton("README.md");
    if (!fileButton) throw new Error("no README.md button");
    await act(async () => {
      fileButton.click();
    });
    expect(document.querySelector(".file-preview-surface")).toBeTruthy();
    await waitForText("Hello");
  });

  it("opens file preview fullscreen and exits with Escape without closing", async () => {
    installFetch();
    await mountApp();
    await waitForText("README.md");
    await clickFileTreeItem("README.md");
    await waitForText("Hello");

    const fullscreenBtn = document.querySelector(
      '[aria-label="全屏预览"]',
    ) as HTMLButtonElement | null;
    if (!fullscreenBtn) throw new Error("no fullscreen button");
    await act(async () => {
      fullscreenBtn.click();
    });

    expect(document.querySelector(".file-preview-fs-root")).toBeTruthy();
    expect(
      document.querySelector(".file-preview-fs-root .file-preview-prose"),
    ).toBeTruthy();
    expect(
      document.querySelector('[aria-label="退出全屏"]'),
    ).toBeTruthy();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(document.querySelector(".file-preview-fs-root")).toBeNull();
    expect(document.querySelector(".file-preview-surface")).toBeTruthy();
    expect(document.querySelector(".file-preview-prose")).toBeTruthy();
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

  it("renders html files in a sandbox iframe instead of markdown prose", async () => {
    installFetch({
      files: new Response(
        JSON.stringify({
          path: ".",
          entries: [{ name: "page.html", type: "file" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
      preview: new Response(
        JSON.stringify({
          path: "page.html",
          kind: "markdown",
          text: "# Title\n",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    });
    await mountApp();
    await waitForText("page.html");
    const fileButton = findFileTreeButton("page.html");
    if (!fileButton) throw new Error("no page.html button");
    await act(async () => {
      fileButton.click();
    });
    const iframe = document.querySelector(".file-preview-html-iframe");
    expect(iframe).toBeTruthy();
    expect(iframe?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(iframe?.getAttribute("src")).toBe(
      "/v1/files/safe-html/content?t=test-token",
    );
    expect(document.querySelector(".file-preview-prose")).toBeNull();
  });

  it("renders spreadsheet files with fortune preview shell", async () => {
    installFetch({
      files: new Response(
        JSON.stringify({
          path: ".",
          entries: [{ name: "report.xlsx", type: "file" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
      preview: new Response(
        JSON.stringify({
          path: "report.xlsx",
          kind: "spreadsheet",
          text: "",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    });
    await mountApp();
    await waitForText("report.xlsx");
    const fileButton = findFileTreeButton("report.xlsx");
    if (!fileButton) throw new Error("no report.xlsx button");
    await act(async () => {
      fileButton.click();
    });
    expect(document.querySelector(".file-preview--spreadsheet")).toBeTruthy();
    expect(document.body.textContent).toContain("Excel");
  });

  it("renders audio files with a playable audio element", async () => {
    installFetch({
      files: new Response(
        JSON.stringify({
          path: ".",
          entries: [{ name: "song.mp3", type: "file" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
      preview: new Response(
        JSON.stringify({
          path: "song.mp3",
          kind: "audio",
          text: "",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    });
    await mountApp();
    await waitForText("song.mp3");
    const fileButton = findFileTreeButton("song.mp3");
    if (!fileButton) throw new Error("no song.mp3 button");
    await act(async () => {
      fileButton.click();
    });
    const audio = document.querySelector("audio.file-preview-audio");
    expect(audio).toBeTruthy();
    expect(audio?.getAttribute("src")).toBe(
      "/v1/files/raw?path=song.mp3",
    );
    expect(audio?.hasAttribute("controls")).toBe(true);
    expect(document.body.textContent).toContain("音频");
    expect(document.body.textContent).not.toContain("无法预览");
  });

  it("renders video files with a playable video element", async () => {
    installFetch({
      files: new Response(
        JSON.stringify({
          path: ".",
          entries: [{ name: "clip.mp4", type: "file" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
      preview: new Response(
        JSON.stringify({
          path: "clip.mp4",
          kind: "video",
          text: "",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    });
    await mountApp();
    await waitForText("clip.mp4");
    const fileButton = findFileTreeButton("clip.mp4");
    if (!fileButton) throw new Error("no clip.mp4 button");
    await act(async () => {
      fileButton.click();
    });
    const video = document.querySelector("video.file-preview-video");
    expect(video).toBeTruthy();
    expect(video?.getAttribute("src")).toBe(
      "/v1/files/raw?path=clip.mp4",
    );
    expect(video?.hasAttribute("controls")).toBe(true);
    expect(document.body.textContent).toContain("视频");
    expect(document.body.textContent).not.toContain("无法预览");
  });

  it("renders image files with an inline image preview", async () => {
    installFetch({
      files: new Response(
        JSON.stringify({
          path: ".",
          entries: [{ name: "photo.png", type: "file" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
      preview: new Response(
        JSON.stringify({
          path: "photo.png",
          kind: "image",
          text: "",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    });
    await mountApp();
    await waitForText("photo.png");
    const fileButton = findFileTreeButton("photo.png");
    if (!fileButton) throw new Error("no photo.png button");
    await act(async () => {
      fileButton.click();
    });
    const image = document.querySelector("img.file-preview-image");
    expect(image).toBeTruthy();
    expect(image?.getAttribute("src")).toBe(
      "/v1/files/raw?path=photo.png",
    );
    expect(image?.getAttribute("alt")).toBe("photo.png");
    expect(document.body.textContent).toContain("图片");
    expect(document.body.textContent).not.toContain("无法预览");
  });

  it("still shows png image preview when preview json is 404", async () => {
    installFetch({
      files: new Response(
        JSON.stringify({
          path: ".",
          entries: [{ name: "sales_chart.png", type: "file" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
      preview: new Response("missing", { status: 404 }),
    });
    await mountApp();
    await waitForText("sales_chart.png");
    const fileButton = findFileTreeButton("sales_chart.png");
    if (!fileButton) throw new Error("no sales_chart.png button");
    await act(async () => {
      fileButton.click();
    });
    const image = document.querySelector("img.file-preview-image");
    expect(image).toBeTruthy();
    expect(image?.getAttribute("src")).toBe(
      "/v1/files/raw?path=sales_chart.png",
    );
    expect(document.body.textContent).not.toContain("host unreachable");
  });

  it("renders office documents with preview and edit tabs", async () => {
    installFetch({
      files: new Response(
        JSON.stringify({
          path: ".",
          entries: [{ name: "report.pdf", type: "file" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
      preview: new Response(
        JSON.stringify({
          path: "report.pdf",
          kind: "pdf",
          text: "",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    });
    await mountApp();
    await waitForText("report.pdf");
    const fileButton = findFileTreeButton("report.pdf");
    if (!fileButton) throw new Error("no report.pdf button");
    await act(async () => {
      fileButton.click();
    });
    expect(document.querySelector(".file-preview--office")).toBeTruthy();
    expect(document.body.textContent).toContain("预览");
    expect(document.body.textContent).toContain("编辑");
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

  it("shows file context menu on right-click", async () => {
    installFetch();
    await mountApp();
    await waitForText("README.md");
    const fileButton = findFileTreeButton("README.md");
    if (!fileButton) throw new Error("no README.md button");
    await act(async () => {
      fireContextMenu(fileButton);
    });
    expect(findContextMenuItem("打开预览")).toBeTruthy();
    expect(findContextMenuItem("重命名")).toBeTruthy();
    expect(findContextMenuItem("移动到文件夹")).toBeTruthy();
    expect(findContextMenuItem("删除")).toBeTruthy();
    const menuItems = document.querySelectorAll(".file-tree-context-menu button");
    expect(menuItems.length).toBeGreaterThan(0);
    for (const item of menuItems) {
      expect(item.querySelector(".file-tree-context-menu__icon")).toBeTruthy();
    }
  });

  it("shows root folder context menu on right-click", async () => {
    installFetch();
    await mountApp();
    await waitForText("README.md");
    const rootButton = findFileTreeButton("工作空间");
    if (!rootButton) throw new Error("no 工作空间 button");
    await act(async () => {
      fireContextMenu(rootButton);
    });
    expect(findContextMenuItem("全部展开")).toBeTruthy();
    expect(findContextMenuItem("全部收起")).toBeTruthy();
    expect(findContextMenuItem("新建文件")).toBeTruthy();
    expect(findContextMenuItem("新建文件夹")).toBeTruthy();
    expect(findContextMenuItem("刷新")).toBeTruthy();
    expect(findContextMenuItem("移动到文件夹")).toBeFalsy();
    expect(findContextMenuItem("删除")).toBeFalsy();
  });

  it("refreshes workspace files from the header button", async () => {
    let entries: Array<{ name: string; type: "file" | "dir" }> = [
      { name: "README.md", type: "file" },
    ];
    installFetch({ listRootEntries: () => entries });
    await mountApp();
    await waitForText("README.md");
    expect(findFileTreeButton("notes.md")).toBeUndefined();

    entries = [
      { name: "README.md", type: "file" },
      { name: "notes.md", type: "file" },
    ];
    const refresh = document.querySelector(
      '[aria-label="刷新文件"]',
    ) as HTMLButtonElement | null;
    if (!refresh) throw new Error("no refresh button");
    await act(async () => {
      refresh.click();
    });
    await waitForText("notes.md");
  });

  it("adds a workspace file when file sync reports it", async () => {
    let entries: Array<{ name: string; type: "file" | "dir" }> = [
      { name: "README.md", type: "file" },
    ];
    let resolveSync: ((res: Response) => void) | undefined;
    let delivered = false;
    installFetch({
      listRootEntries: () => entries,
      filesSync: (_input, init) => {
        if (delivered) return hangUntilAbort(init?.signal);
        return new Promise<Response>((resolve) => {
          resolveSync = (res) => {
            delivered = true;
            resolve(res);
          };
        });
      },
    });
    await mountApp();
    await waitForText("README.md");
    expect(findFileTreeButton("notes.md")).toBeUndefined();
    const urls = vi.mocked(fetch).mock.calls.map(([input]) => requestUrl(input));
    expect(urls.some((u) => u.includes("/v1/files/sync?generation=0"))).toBe(
      true,
    );

    entries = [
      { name: "README.md", type: "file" },
      { name: "notes.md", type: "file" },
    ];
    await act(async () => {
      resolveSync?.(
        new Response(
          JSON.stringify({
            generation: 1,
            dirs: ["."],
            files: ["notes.md"],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    });
    await waitForText("notes.md");
  });

  it("creates a file from the root context menu", async () => {
    installFetch();
    await mountApp();
    await waitForText("README.md");
    const rootButton = findFileTreeButton("工作空间");
    if (!rootButton) throw new Error("no 工作空间 button");
    await act(async () => {
      fireContextMenu(rootButton);
    });
    const createItem = findContextMenuItem("新建文件");
    if (!createItem) throw new Error("no 新建文件 item");
    await act(async () => {
      createItem.click();
    });
    const nameInput = document.querySelector(
      ".file-action-dialog input",
    ) as HTMLInputElement | null;
    if (!nameInput) throw new Error("no name input");
    await act(async () => {
      const proto = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      );
      proto?.set?.call(nameInput, "notes.md");
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const confirm = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "创建",
    ) as HTMLButtonElement | undefined;
    if (!confirm) throw new Error("no 创建 button");
    await act(async () => {
      confirm.click();
    });
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const createCall = fetchMock.mock.calls.find(([input, init]) => {
      const url = requestUrl(input as RequestInfo | URL);
      return (
        url.includes("/v1/files/create") &&
        (init as RequestInit | undefined)?.method === "POST"
      );
    });
    expect(createCall).toBeTruthy();
    const body = JSON.parse(String((createCall![1] as RequestInit).body)) as {
      path: string;
    };
    expect(body.path).toBe("notes.md");
  });

  it("deletes a file after confirming from the context menu", async () => {
    installFetch();
    await mountApp();
    await waitForText("README.md");
    const fileButton = findFileTreeButton("README.md");
    if (!fileButton) throw new Error("no README.md button");
    await act(async () => {
      fireContextMenu(fileButton);
    });
    const deleteItem = findContextMenuItem("删除");
    if (!deleteItem) throw new Error("no 删除 item");
    await act(async () => {
      deleteItem.click();
    });
    const confirmBtn = Array.from(
      document.querySelectorAll(".file-action-dialog button"),
    ).find((b) => b.textContent === "删除") as HTMLButtonElement | undefined;
    if (!confirmBtn) throw new Error("no confirm 删除 button");
    await act(async () => {
      confirmBtn.click();
    });
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const deleteCall = fetchMock.mock.calls.find(([input, init]) => {
      const url = requestUrl(input as RequestInfo | URL);
      return (
        url.includes("/v1/files") &&
        (init as RequestInit | undefined)?.method === "DELETE"
      );
    });
    expect(deleteCall).toBeTruthy();
    expect(requestUrl(deleteCall![0] as RequestInfo | URL)).toContain(
      "path=README.md",
    );
  });

  it("shows folder context menu with move on right-click", async () => {
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
    await waitForText("docs");
    const docsButton = findFileTreeButton("docs");
    if (!docsButton) throw new Error("no docs button");
    await act(async () => {
      fireContextMenu(docsButton);
    });
    expect(findContextMenuItem("展开")).toBeTruthy();
    expect(findContextMenuItem("刷新")).toBeTruthy();
    expect(findContextMenuItem("新建文件")).toBeTruthy();
    expect(findContextMenuItem("新建子文件夹")).toBeTruthy();
    expect(findContextMenuItem("重命名")).toBeTruthy();
    expect(findContextMenuItem("移动到文件夹")).toBeTruthy();
    expect(findContextMenuItem("删除")).toBeTruthy();
  });

  it("moves a file into a folder from the context menu", async () => {
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
    const fileButton = findFileTreeButton("README.md");
    if (!fileButton) throw new Error("no README.md button");
    await act(async () => {
      fireContextMenu(fileButton);
    });
    const moveItem = findContextMenuItem("移动到文件夹");
    if (!moveItem) throw new Error("no 移动到文件夹 item");
    await act(async () => {
      moveItem.click();
    });
    await waitForText("选择目标文件夹");
    const docsTarget = Array.from(
      document.querySelectorAll(".file-move-dialog button"),
    ).find((b) => b.textContent?.includes("docs")) as HTMLButtonElement | undefined;
    if (!docsTarget) throw new Error("no docs move target");
    await act(async () => {
      docsTarget.click();
    });
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const renameCall = fetchMock.mock.calls.find(([input, init]) => {
      const url = requestUrl(input as RequestInfo | URL);
      return (
        url.includes("/v1/files/rename") &&
        (init as RequestInit | undefined)?.method === "POST"
      );
    });
    expect(renameCall).toBeTruthy();
    const body = JSON.parse(String((renameCall![1] as RequestInit).body)) as {
      path: string;
      to: string;
    };
    expect(body.path).toBe("README.md");
    expect(body.to).toBe("docs/README.md");
  });

  it("moves a folder into another folder from the context menu", async () => {
    installFetch({
      files: new Response(
        JSON.stringify({
          path: ".",
          entries: [
            { name: "docs", type: "dir" },
            { name: "md", type: "dir" },
            { name: "README.md", type: "file" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    });
    await mountApp();
    await waitForText("docs");
    const docsButton = findFileTreeButton("docs");
    if (!docsButton) throw new Error("no docs button");
    await act(async () => {
      fireContextMenu(docsButton);
    });
    const moveItem = findContextMenuItem("移动到文件夹");
    if (!moveItem) throw new Error("no 移动到文件夹 item");
    await act(async () => {
      moveItem.click();
    });
    await waitForText("选择目标文件夹");
    const mdTarget = Array.from(
      document.querySelectorAll(".file-move-dialog button"),
    ).find((b) => b.textContent?.includes("md")) as HTMLButtonElement | undefined;
    if (!mdTarget) throw new Error("no md move target");
    await act(async () => {
      mdTarget.click();
    });
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const renameCall = fetchMock.mock.calls.find(([input, init]) => {
      const url = requestUrl(input as RequestInfo | URL);
      return (
        url.includes("/v1/files/rename") &&
        (init as RequestInit | undefined)?.method === "POST"
      );
    });
    expect(renameCall).toBeTruthy();
    const body = JSON.parse(String((renameCall![1] as RequestInit).body)) as {
      path: string;
      to: string;
    };
    expect(body.path).toBe("docs");
    expect(body.to).toBe("md/docs");
  });

  function createDataTransfer() {
    const data = new Map<string, string>();
    const types: string[] = [];
    return {
      dropEffect: "none" as DataTransfer["dropEffect"],
      effectAllowed: "all" as DataTransfer["effectAllowed"],
      files: [] as unknown as FileList,
      items: [] as unknown as DataTransferItemList,
      types,
      setData(format: string, value: string) {
        if (!data.has(format)) types.push(format);
        data.set(format, value);
      },
      getData(format: string) {
        return data.get(format) ?? "";
      },
      clearData(format?: string) {
        if (format) {
          data.delete(format);
          const index = types.indexOf(format);
          if (index >= 0) types.splice(index, 1);
        } else {
          data.clear();
          types.length = 0;
        }
      },
      setDragImage() {},
    };
  }

  function fireDrag(
    el: EventTarget,
    type: string,
    dataTransfer: ReturnType<typeof createDataTransfer>,
  ) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
    el.dispatchEvent(event);
  }

  async function dragFileTreeItem(sourceName: string, targetName: string) {
    const source = findFileTreeButton(sourceName);
    const target = findFileTreeButton(targetName);
    if (!source) throw new Error(`no ${sourceName} button`);
    if (!target) throw new Error(`no ${targetName} button`);
    const dataTransfer = createDataTransfer();
    await act(async () => {
      fireDrag(source, "dragstart", dataTransfer);
      fireDrag(target, "dragenter", dataTransfer);
      fireDrag(target, "dragover", dataTransfer);
      fireDrag(target, "drop", dataTransfer);
      fireDrag(source, "dragend", dataTransfer);
    });
  }

  function findRenameCall() {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    return fetchMock.mock.calls.find(([input, init]) => {
      const url = requestUrl(input as RequestInfo | URL);
      return (
        url.includes("/v1/files/rename") &&
        (init as RequestInit | undefined)?.method === "POST"
      );
    });
  }

  it("moves a file into a folder by dragging", async () => {
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
    await dragFileTreeItem("README.md", "docs");
    const renameCall = findRenameCall();
    expect(renameCall).toBeTruthy();
    const body = JSON.parse(String((renameCall![1] as RequestInit).body)) as {
      path: string;
      to: string;
    };
    expect(body.path).toBe("README.md");
    expect(body.to).toBe("docs/README.md");
  });

  it("moves a folder into another folder by dragging", async () => {
    installFetch({
      files: new Response(
        JSON.stringify({
          path: ".",
          entries: [
            { name: "docs", type: "dir" },
            { name: "md", type: "dir" },
            { name: "README.md", type: "file" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    });
    await mountApp();
    await waitForText("docs");
    await dragFileTreeItem("docs", "md");
    const renameCall = findRenameCall();
    expect(renameCall).toBeTruthy();
    const body = JSON.parse(String((renameCall![1] as RequestInit).body)) as {
      path: string;
      to: string;
    };
    expect(body.path).toBe("docs");
    expect(body.to).toBe("md/docs");
  });

  it("does not move a file when dropped onto its current folder", async () => {
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
    await dragFileTreeItem("README.md", "工作空间");
    expect(findRenameCall()).toBeUndefined();
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

    await clickFileTreeItem("README.md");
    await clickFileTreeItem("notes.txt");
    await waitForText("FRESH-PREVIEW-TEXT");

    await act(async () => {
      releaseStale?.();
      await new Promise((r) => setTimeout(r, 40));
    });

    expect(document.body.textContent).toContain("FRESH-PREVIEW-TEXT");
    expect(document.body.textContent).not.toContain("STALE-PREVIEW-TEXT");
  });

  it("renders a2ui surface and waits with composer in cancel state", async () => {
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
    expect(sendButton!.disabled).toBe(false);
    expect(sendButton!.classList.contains("btn-send--stop")).toBe(true);
    expect(sendButton!.getAttribute("aria-label")).toBe("取消");
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

  it("renders guard ask with tool name only and composer in cancel state", async () => {
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
    expect(sendButton?.classList.contains("btn-send--stop")).toBe(true);
    expect(sendButton?.getAttribute("aria-label")).toBe("取消");
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
    expect(sendButton?.classList.contains("btn-send--stop")).toBe(true);
    expect(sendButton?.getAttribute("aria-label")).toBe("取消");
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

  it("keeps composer in cancel state when cancel is not HTTP 200", async () => {
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
    expect(sendButton?.classList.contains("btn-send--stop")).toBe(true);
    expect(sendButton?.disabled).toBe(false);
    if (!sendButton) throw new Error("no cancel");
    await act(async () => {
      sendButton.click();
      await Promise.resolve();
    });
    expect(sendButton.classList.contains("btn-send--stop")).toBe(true);
    expect(sendButton.getAttribute("aria-label")).toBe("取消");
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
    expect(readme.getAttribute("aria-selected")).not.toBe("true");
    await act(async () => {
      docs.click();
    });
    expect(docs.classList.contains("file-tree__row--active")).toBe(false);
    await act(async () => {
      readme.click();
    });
    expect(readme.getAttribute("aria-selected")).toBe("true");
    expect(readme.classList.contains("file-tree__row--active")).toBe(true);
    expect(docs.classList.contains("file-tree__row--active")).toBe(false);
  });

  it("uses one composer action button for send and cancel states", async () => {
    installFetch({
      turn: new Response(SURFACE_SSE, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    });
    await mountApp();
    const send = document.querySelector(".btn-send");
    expect(send?.classList.contains("btn-send")).toBe(true);
    expect(send?.classList.contains("btn-send--stop")).toBe(false);
    expect(send?.getAttribute("aria-label")).toBe("发送");
    expect(send?.querySelector(".btn-send-arrow")).toBeTruthy();
    await typeAndSend("hi");
    await waitForText("OK");
    const action = document.querySelector(".btn-send");
    expect(action?.classList.contains("btn-send--stop")).toBe(true);
    expect(action?.getAttribute("aria-label")).toBe("取消");
    expect(
      Array.from(document.querySelectorAll("button")).some((b) => b.textContent === "取消"),
    ).toBe(false);
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

  it("shows attachment button even when omni is not configured", async () => {
    installFetch({
      models: new Response(
        JSON.stringify([{ kind: "chat", configured: true, defaultId: "default" }]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    });
    await mountApp();
    await waitForText("附件");
    expect(
      Array.from(document.querySelectorAll("button")).some((btn) => btn.textContent === "附件"),
    ).toBe(true);
  });

  it("shows an output format button next to attachments", async () => {
    installFetch();
    await mountApp();
    await waitForText("输出");
    expect(
      Array.from(document.querySelectorAll(".composer-tools button")).some(
        (btn) => btn.textContent === "输出",
      ),
    ).toBe(true);
  });

  it("sends a pptx generate constraint and clears the chip after send", async () => {
    installFetch();
    await mountApp();
    await waitForText("输出");
    const outputBtn = Array.from(
      document.querySelectorAll(".composer-tools button"),
    ).find((btn) => btn.textContent === "输出") as HTMLButtonElement | undefined;
    if (!outputBtn) throw new Error("no 输出 button");
    await act(async () => {
      outputBtn.click();
    });
    const pptBtn = Array.from(document.querySelectorAll("button")).find(
      (btn) => btn.textContent === "PPT",
    );
    if (!pptBtn) throw new Error("no PPT option");
    await act(async () => {
      pptBtn.click();
    });
    await waitForText("将写成 PPT");
    await typeAndSend("做一份三国介绍");
    await waitForText("hello");
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const turnCall = fetchMock.mock.calls.find(([input, init]) => {
      const url = requestUrl(input as RequestInfo | URL);
      return url.includes("/v1/turns") && (init as RequestInit | undefined)?.method === "POST";
    });
    const body = JSON.parse(String((turnCall![1] as RequestInit).body)) as {
      text: string;
    };
    expect(body.text).toContain("做一份三国介绍");
    expect(body.text).toContain(".pptx");
    expect(body.text).toContain("doc_generate");
    expect(document.body.textContent).not.toContain("将写成 PPT");
  });

  it("opens the generated file when doc_generate matches the selected format", async () => {
    const generateSse =
      `data: ${JSON.stringify({
        type: "tool/call",
        callId: "g1",
        name: "doc_generate",
        args: { source: "draft.md", out: "talk.pptx" },
      })}\n\n` +
      `data: ${JSON.stringify({
        type: "tool/result",
        callId: "g1",
        name: "doc_generate",
        text: JSON.stringify({
          status: "ok",
          source: "draft.md",
          out: "talk.pptx",
          format: "pptx",
        }),
      })}\n\n` +
      `data: {"type":"assistant/message","text":"写好了"}\n\n` +
      `data: {"type":"end","status":"ok"}\n\n`;
    installFetch({
      turn: new Response(generateSse, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    });
    await mountApp();
    await waitForText("输出");
    const outputBtn = Array.from(
      document.querySelectorAll(".composer-tools button"),
    ).find((btn) => btn.textContent === "输出") as HTMLButtonElement | undefined;
    if (!outputBtn) throw new Error("no 输出 button");
    await act(async () => {
      outputBtn.click();
    });
    const pptBtn = Array.from(document.querySelectorAll("button")).find(
      (btn) => btn.textContent === "PPT",
    );
    if (!pptBtn) throw new Error("no PPT option");
    await act(async () => {
      pptBtn.click();
    });
    await typeAndSend("做一份三国介绍");
    await waitForText("写好了");
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const previewCall = fetchMock.mock.calls.find(([input]) =>
      requestUrl(input as RequestInfo | URL).includes(
        "/v1/files/preview?path=talk.pptx",
      ),
    );
    expect(previewCall).toBeTruthy();
  });

  it("exports a markdown preview to html", async () => {
    installFetch();
    await mountApp();
    await waitForText("README.md");
    await clickFileTreeItem("README.md");
    await waitForText("导出");
    const exportBtn = Array.from(document.querySelectorAll("button")).find(
      (btn) => btn.textContent === "导出",
    );
    if (!exportBtn) throw new Error("no 导出 button");
    await act(async () => {
      exportBtn.click();
    });
    const htmlBtn = Array.from(document.querySelectorAll("button")).find(
      (btn) => btn.textContent === "HTML",
    );
    if (!htmlBtn) throw new Error("no HTML export option");
    await act(async () => {
      htmlBtn.click();
    });
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const convertCall = fetchMock.mock.calls.find(([input, init]) => {
      const url = requestUrl(input as RequestInfo | URL);
      return (
        url.includes("/v1/files/convert") &&
        (init as RequestInit | undefined)?.method === "POST"
      );
    });
    expect(convertCall).toBeTruthy();
    expect(JSON.parse(String((convertCall![1] as RequestInit).body))).toEqual({
      source: "README.md",
      out: "README.html",
    });
  });

  it("writes attached files into uploads and sends their paths", async () => {
    installFetch();
    await mountApp();
    await waitForText("附件");
    const fileInput = document.querySelector(
      ".composer-tools input[type=file]",
    ) as HTMLInputElement | null;
    if (!fileInput) throw new Error("no file input");
    const file = new File(["hello notes"], "notes.txt", { type: "text/plain" });
    await act(async () => {
      Object.defineProperty(fileInput, "files", {
        configurable: true,
        value: fileListOf([file]),
      });
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await waitForText("uploads/notes.txt");
    const sendButton = document.querySelector(".btn-send") as HTMLButtonElement | null;
    expect(sendButton?.disabled).toBe(false);
    await act(async () => {
      sendButton!.click();
    });
    await waitForText("hello");
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const mkdirCall = fetchMock.mock.calls.find(([input]) =>
      requestUrl(input as RequestInfo | URL).includes("/v1/files/mkdir"),
    );
    expect(mkdirCall).toBeTruthy();
    expect(JSON.parse(String((mkdirCall![1] as RequestInit).body))).toEqual({
      path: "uploads",
    });
    const createCall = fetchMock.mock.calls.find(([input]) =>
      requestUrl(input as RequestInfo | URL).includes("/v1/files/create"),
    );
    expect(JSON.parse(String((createCall![1] as RequestInit).body))).toEqual({
      path: "uploads/notes.txt",
    });
    const rawPut = fetchMock.mock.calls.find(([input, init]) => {
      const url = requestUrl(input as RequestInfo | URL);
      return url.includes("/v1/files/raw") && (init as RequestInit | undefined)?.method === "PUT";
    });
    expect(rawPut).toBeTruthy();
    expect(requestUrl(rawPut![0] as RequestInfo | URL)).toContain(
      "path=uploads%2Fnotes.txt",
    );
    const turnCall = fetchMock.mock.calls.find(([input, init]) => {
      const url = requestUrl(input as RequestInfo | URL);
      return url.includes("/v1/turns") && (init as RequestInit | undefined)?.method === "POST";
    });
    expect(turnCall).toBeTruthy();
    const body = JSON.parse(String((turnCall![1] as RequestInit).body)) as {
      text: string;
      images?: unknown;
    };
    expect(body.text).toContain("uploads/notes.txt");
    expect(body.images).toBeUndefined();
  });

  it("sends attached images as vision parts when omni is configured", async () => {
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
    await waitForText("附件");
    const fileInput = document.querySelector(
      ".composer-tools input[type=file]",
    ) as HTMLInputElement | null;
    if (!fileInput) throw new Error("no file input");
    const file = new File([new Uint8Array([1, 2, 3, 4])], "photo.png", {
      type: "image/png",
    });
    await act(async () => {
      Object.defineProperty(fileInput, "files", {
        configurable: true,
        value: fileListOf([file]),
      });
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await waitForText("uploads/photo.png");
    const sendButton = document.querySelector(".btn-send") as HTMLButtonElement | null;
    expect(sendButton?.disabled).toBe(false);
    await act(async () => {
      sendButton!.click();
    });
    await waitForText("hello");
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const turnCall = fetchMock.mock.calls.find(([input, init]) => {
      const url = requestUrl(input as RequestInfo | URL);
      return url.includes("/v1/turns") && (init as RequestInit | undefined)?.method === "POST";
    });
    const body = JSON.parse(String((turnCall![1] as RequestInit).body)) as {
      text: string;
      images?: { mime: string; data: string }[];
    };
    expect(body.text).toContain("uploads/photo.png");
    expect(body.images).toEqual([{ mime: "image/png", data: expect.any(String) }]);
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
    expect(document.body.textContent).not.toContain("关闭窗口时");
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

  it("renders a2ui DataTable and Chart from updateDataModel bindings", async () => {
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
            { id: "tbl", component: "DataTable", data: { path: "/tbl" } },
            { id: "chart", component: "Chart", kind: "line", data: { path: "/chart" } },
          ],
        },
      },
      {
        version: "v0.9" as const,
        updateDataModel: {
          surfaceId: "main",
          path: "/tbl",
          value: { headers: ["sku", "qty"], rows: [["widget", "9"]] },
        },
      },
      {
        version: "v0.9" as const,
        updateDataModel: {
          surfaceId: "main",
          path: "/chart",
          value: { labels: ["Jan", "Feb"], values: [1, 3] },
        },
      },
    ];
    const sse =
      `data: {"type":"turn/start","turnId":"t-bind"}\n\n` +
      `data: ${JSON.stringify({
        type: "a2ui/surface",
        turnId: "t-bind",
        surfaceId: "main",
        wait: false,
        messages,
      })}\n\n` +
      `data: {"type":"assistant/message","text":"bound"}\n\n` +
      `data: {"type":"end","status":"ok"}\n\n`;
    installFetch({
      turn: new Response(sse, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    });
    await mountApp();
    await typeAndSend("show bound data");
    await waitForText("widget");
    expect(document.querySelector(".a2ui-table")).toBeTruthy();
    expect(document.body.textContent).toContain("sku");
    const chartSvgEl = document.querySelector(".a2ui-chart-svg");
    expect(chartSvgEl).toBeTruthy();
    expect(chartSvgEl?.innerHTML).toContain("polyline");
    expect(document.body.textContent).toContain("Jan");
  });

  it("renders a2ui radar and heatmap charts", async () => {
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
            { id: "root", component: "Column", children: ["radar", "heat"] },
            {
              id: "radar",
              component: "Chart",
              kind: "radar",
              labels: ["Attack", "Defense", "Speed"],
              values: [80, 60, 90],
            },
            {
              id: "heat",
              component: "Chart",
              kind: "heatmap",
              xLabels: ["Mon", "Tue"],
              yLabels: ["AM", "PM"],
              values: [
                [1, 2],
                [3, 4],
              ],
            },
          ],
        },
      },
    ];
    const sse =
      `data: {"type":"turn/start","turnId":"t-radar-heat"}\n\n` +
      `data: ${JSON.stringify({
        type: "a2ui/surface",
        turnId: "t-radar-heat",
        surfaceId: "main",
        wait: false,
        messages,
      })}\n\n` +
      `data: {"type":"assistant/message","text":"charts"}\n\n` +
      `data: {"type":"end","status":"ok"}\n\n`;
    installFetch({
      turn: new Response(sse, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    });
    await mountApp();
    await typeAndSend("show radar heatmap");
    await waitForText("Attack");
    const svgs = Array.from(document.querySelectorAll(".a2ui-chart-svg"));
    expect(svgs).toHaveLength(2);
    expect(svgs.some((el) => el.getAttribute("aria-label") === "radar chart")).toBe(true);
    expect(svgs.some((el) => el.getAttribute("aria-label") === "heatmap chart")).toBe(true);
    expect(document.body.textContent).toContain("Mon");
    expect(document.body.textContent).toContain("AM");
  });

  it("keeps live reasoning, tool step, a2ui chart, and footer in event order", async () => {
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
            { id: "root", component: "Column", children: ["radar"] },
            {
              id: "radar",
              component: "Chart",
              kind: "radar",
              labels: ["OrderProbeAtk", "OrderProbeDef", "OrderProbeSpd"],
              values: [80, 60, 90],
            },
          ],
        },
      },
    ];
    const sse =
      `data: {"type":"turn/start","turnId":"t-order"}\n\n` +
      `data: {"type":"step/start","turnId":"t-order","step":1}\n\n` +
      `data: ${JSON.stringify({
        type: "assistant/reasoning-chunk",
        text: "will-draw-order-probe",
      })}\n\n` +
      `data: {"type":"step/start","turnId":"t-order","step":2}\n\n` +
      `data: ${JSON.stringify({
        type: "tool/call",
        callId: "c-a2ui",
        name: "a2ui_emit",
        args: { messages },
      })}\n\n` +
      `data: ${JSON.stringify({
        type: "tool/result",
        callId: "c-a2ui",
        name: "a2ui_emit",
        text: JSON.stringify({ status: "ok", emitId: "e1", wait: false, surfaceId: "main" }),
      })}\n\n` +
      `data: ${JSON.stringify({
        type: "a2ui/surface",
        turnId: "t-order",
        surfaceId: "main",
        wait: false,
        messages,
      })}\n\n` +
      `data: ${JSON.stringify({
        type: "assistant/reasoning-chunk",
        text: "already-emitted-order-probe",
      })}\n\n` +
      `data: ${JSON.stringify({
        type: "turn/stats",
        turnId: "t-order",
        steps: 2,
        toolCalls: 1,
        durationMs: 12400,
        llmMs: 12400,
        ttftMs: 3200,
        ttftSteps: 1,
        decodeMs: 9000,
        outputTokens: 750,
        guard: { allow: 0, deny: 0, ask: 0, suspicious: 0 },
      })}\n\n` +
      `data: {"type":"end","status":"ok"}\n\n`;
    installFetch({
      turn: new Response(sse, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    });
    await mountApp();
    await typeAndSend("draw radar");
    await waitForText("already-emitted-order-probe");
    await waitForText("2 steps");
    const kinds = Array.from(document.querySelectorAll(".log > .message-turn")).map((el) => {
      const cls = [...el.classList].find((c) => c.startsWith("message-") && c !== "message-turn");
      return cls?.slice("message-".length) ?? "";
    });
    expect(kinds).toEqual([
      "user",
      "reasoning",
      "tool-step",
      "a2ui",
      "reasoning",
      "turn-footer",
    ]);
    expect(document.querySelectorAll(".log > .message-tool-step")).toHaveLength(1);
    expect(document.querySelector(".a2ui-chart-svg")).toBeTruthy();
    const reasoningTexts = Array.from(
      document.querySelectorAll(
        ".log > .message-reasoning .reasoning-body, .log > .message-reasoning .reasoning-peek, .log > .message-reasoning .disclosure-row-summary",
      ),
    ).map((el) => el.textContent);
    expect(reasoningTexts.some((t) => t?.includes("will-draw-order-probe"))).toBe(true);
    expect(reasoningTexts.some((t) => t?.includes("already-emitted-order-probe"))).toBe(true);
    const last = kinds[kinds.length - 1];
    expect(last).toBe("turn-footer");
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

  it("renders a2ui Infographic from AntV syntax", async () => {
    const syntax =
      "infographic list-row-simple-horizontal-arrow\ndata\n  lists\n    - label Alpha\n      desc Start\n";
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
            { id: "root", component: "Infographic", syntax },
          ],
        },
      },
    ];
    const sse =
      `data: {"type":"turn/start","turnId":"t-antv"}\n\n` +
      `data: ${JSON.stringify({
        type: "a2ui/surface",
        turnId: "t-antv",
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
    await typeAndSend("show antv");
    const el = document.querySelector(".a2ui-infographic--antv");
    expect(el).toBeTruthy();
    expect(el?.getAttribute("data-syntax")).toContain("list-row-simple-horizontal-arrow");
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
    const started = Date.now();
    while (Date.now() - started < 2000 && !document.querySelector(".chat-file-card")) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 15));
      });
    }
    const card = document.querySelector(".chat-file-card");
    expect(card).toBeTruthy();
    expect(card?.textContent).toContain("README.md");
    await act(async () => {
      card?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await waitForText("Hello");
    const preview = document.querySelector(".file-preview-prose");
    expect(preview?.textContent).toContain("Hello");
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

  it("shows a sticky web search toggle and sends webSearch only when on", async () => {
    installFetch();
    await mountApp();
    await waitForText("联网");
    const toggle = Array.from(
      document.querySelectorAll(".composer-tools button"),
    ).find((btn) => btn.textContent === "联网") as HTMLButtonElement | undefined;
    if (!toggle) throw new Error("no 联网 button");
    expect(toggle.className).not.toContain("composer-tool-btn--active");

    await act(async () => {
      toggle.click();
    });
    expect(toggle.className).toContain("composer-tool-btn--active");
    await typeAndSend("今天天气");
    await waitForText("hello");
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const turnCall = fetchMock.mock.calls.find(([input, init]) => {
      const url = requestUrl(input as RequestInfo | URL);
      return url.includes("/v1/turns") && (init as RequestInit | undefined)?.method === "POST";
    });
    const body = JSON.parse(String((turnCall![1] as RequestInit).body)) as {
      text: string;
      webSearch?: boolean;
    };
    expect(body.text).toBe("今天天气");
    expect(body.webSearch).toBe(true);

    await act(async () => {
      toggle.click();
    });
    await typeAndSend("第二轮");
    await waitForText("hello");
    const second = [...fetchMock.mock.calls].reverse().find(([input, init]) => {
      const url = requestUrl(input as RequestInfo | URL);
      return url.includes("/v1/turns") && (init as RequestInit | undefined)?.method === "POST";
    });
    const body2 = JSON.parse(String((second![1] as RequestInit).body)) as {
      webSearch?: boolean;
    };
    expect(body2).not.toHaveProperty("webSearch");
  });

  it("keeps chat as default and does not mount trajectory ledger", async () => {
    installFetch();
    await mountApp();
    await typeAndSend("typed locally");
    expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("对话");
    expect(document.querySelector(".trajectory-root")).toBeNull();
  });

  it("rebuilds trajectory from events without changing chat tool truncation", async () => {
    const result = "r".repeat(2001);
    const toolSse =
      `data: ${JSON.stringify({ type: "tool/call", callId: "c1", name: "fs", args: { path: "a.txt" } })}\n\n` +
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
    await waitForText("File");
    expect(document.querySelector(".trajectory-root")).toBeNull();
    expect(document.body.textContent).not.toContain(result);

    const trajTab = [...document.querySelectorAll('[role="tab"]')].find((el) => el.textContent === "轨迹");
    await act(async () => {
      (trajTab as HTMLButtonElement).click();
    });
    const log = document.querySelector(".log") as HTMLElement | null;
    expect(log?.hasAttribute("hidden")).toBe(true);
    expect(log ? getComputedStyle(log).display : "").toBe("none");
    const panel = document.querySelector('[data-trajectory-id="tool:c1"]');
    expect(panel).toBeTruthy();
    await act(async () => {
      (panel as HTMLElement).click();
    });
    expect(document.querySelector("[data-inspector-panel]")?.textContent).toContain(result);
    expect(document.querySelector(".log")).toBeTruthy();
  });

  it("jumps from a tool row inspect button to the trajectory record", async () => {
    const toolSse =
      `data: ${JSON.stringify({ type: "tool/call", callId: "c1", name: "fs", args: { path: "a.txt" } })}\n\n` +
      `data: ${JSON.stringify({ type: "tool/result", callId: "c1", name: "fs", text: "hello-out" })}\n\n` +
      `data: ${JSON.stringify({ type: "end", status: "ok" })}\n\n`;
    installFetch({
      turn: new Response(toolSse, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    });
    await mountApp();
    await typeAndSend("use tool");
    await waitForText("File");
    const inspect = document.querySelector('[aria-label="在轨迹中查看"]') as HTMLButtonElement;
    await act(async () => {
      inspect.click();
    });
    expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("轨迹");
    const row = document.querySelector('[data-trajectory-id="tool:c1"]');
    expect(row?.getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector("[data-inspector-panel]")?.textContent).toContain("hello-out");
  });

  it("switches back to chat when guard ask arrives on trajectory", async () => {
    installFetch({
      turn: new Response(GUARD_SSE, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    });
    await mountApp();
    const trajTab = [...document.querySelectorAll('[role="tab"]')].find((el) => el.textContent === "轨迹");
    await act(async () => {
      (trajTab as HTMLButtonElement).click();
    });
    expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("轨迹");
    await typeAndSend("run tool");
    await waitForText("允许执行工具");
    expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("对话");
    expect(document.querySelector(".log")?.hasAttribute("hidden")).toBe(false);
  });

  it("switches back to chat when a2ui wait surface arrives on trajectory", async () => {
    installFetch({
      turn: new Response(SURFACE_SSE, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    });
    await mountApp();
    const trajTab = [...document.querySelectorAll('[role="tab"]')].find((el) => el.textContent === "轨迹");
    await act(async () => {
      (trajTab as HTMLButtonElement).click();
    });
    await typeAndSend("confirm");
    await waitForText("Continue?");
    expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("对话");
  });
});
