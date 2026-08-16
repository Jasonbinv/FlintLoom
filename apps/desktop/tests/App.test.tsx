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
  files?: Response | Error;
  preview?: Response | Error;
} = {}) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = requestUrl(input);
    if (url.includes("/v1/files/preview")) {
      if (opts.preview instanceof Error) throw opts.preview;
      return (
        opts.preview ??
        new Response(
          JSON.stringify({
            path: "README.md",
            kind: "markdown",
            text: "# Hello\n",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
      );
    }
    if (url.includes("/v1/files")) {
      if (opts.files instanceof Error) throw opts.files;
      return (
        opts.files ??
        new Response(
          JSON.stringify({
            path: ".",
            entries: [{ name: "README.md", type: "file" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )
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
      return new Response(null, { status: 200 });
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
});
