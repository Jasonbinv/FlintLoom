import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { ChatProvider } from "@flintloom/models";
import { ModelRegistry } from "@flintloom/models";
import { loadOrCreateToken, startHost } from "../src/index.ts";
import { writeAssembly } from "./assembly.ts";

const here = fileURLToPath(new URL(".", import.meta.url));

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

function hangChat(): ChatProvider {
  return {
    async *stream(_req, signal) {
      await new Promise<void>((_resolve, reject) => {
        const onAbort = () => reject(new Error("aborted"));
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      });
    },
  };
}

function textChat(text: string): ChatProvider {
  return {
    async *stream() {
      yield { type: "text", text };
    },
  };
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function waitForTurnStart(
  url: string,
  token: string,
  sessionId: string,
): Promise<string> {
  const started = Date.now();
  while (Date.now() - started < 5000) {
    const peek = await fetch(`${url}/v1/sessions/${sessionId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (peek.status === 200) {
      const body = (await peek.json()) as {
        events: { type: string; turnId?: string }[];
      };
      const start = body.events.find((e) => e.type === "turn/start");
      if (start?.turnId) {
        return start.turnId;
      }
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("timeout waiting for turn/start");
}

describe("POST /v1/hooks", () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (close) {
      await close();
      close = undefined;
    }
  });

  it("returns 401 without bearer and 404 when channel-webhook is omitted", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-hooks-omit-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-hooks-omit-home-"));
    writeFileSync(
      join(workspaceRoot, "flintloom.yml"),
      `plugins:
  - id: models
    name: "@flintloom/models"
  - id: tools
    name: "@flintloom/tools"
  - id: session
    name: "@flintloom/session"
  - id: models-chat
    name: "@flintloom/models-chat"
  - id: loop
    name: "@flintloom/loop"
`,
    );
    const host = await startHost({ workspaceRoot, homeDir, port: 0 });
    close = host.close;
    const unauth = await fetch(`${host.url}/v1/hooks`, {
      method: "POST",
      body: JSON.stringify({ text: "hi" }),
    });
    expect(unauth.status).toBe(401);
    const token = loadOrCreateToken(homeDir);
    const res = await fetch(`${host.url}/v1/hooks`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({ text: "hi" }),
    });
    expect(res.status).toBe(404);
  });

  it("accepts a turn and defaults session id webhook", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-hooks-ok-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-hooks-ok-home-"));
    writeAssembly(workspaceRoot);
    const host = await startHost({ workspaceRoot, homeDir, port: 0 });
    close = host.close;
    const token = loadOrCreateToken(homeDir);
    const models = host.runtime.ctx.require<ModelRegistry>("models");
    models.registerChat("fake", textChat("hook-hello"));
    models.setDefault("chat", "fake");
    const res = await fetch(`${host.url}/v1/hooks`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({ text: "  hi  " }),
    });
    expect(res.status).toBe(200);
    const raw = await res.text();
    const body = JSON.parse(raw) as { turnId: string; status: string; text: string };
    expect(Object.keys(JSON.parse(raw) as object)).toEqual(["turnId", "status", "text"]);
    expect(body.status).toBe("ok");
    expect(body.text).toBe("hook-hello");
    const session = await fetch(`${host.url}/v1/sessions/webhook`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const log = (await session.json()) as { events: { type: string; text?: string }[] };
    const user = log.events.find((e) => e.type === "user/message");
    expect(user?.text).toBe("hi");
  });

  it("returns 400 for empty text and 409 while a turn is in flight", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-hooks-err-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-hooks-err-home-"));
    writeAssembly(workspaceRoot);
    const host = await startHost({ workspaceRoot, homeDir, port: 0 });
    close = host.close;
    const token = loadOrCreateToken(homeDir);
    const models = host.runtime.ctx.require<ModelRegistry>("models");
    models.registerChat("fake", hangChat());
    models.setDefault("chat", "fake");
    const empty = await fetch(`${host.url}/v1/hooks`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({ text: "  " }),
    });
    expect(empty.status).toBe(400);
    const pending = fetch(`${host.url}/v1/hooks`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({ text: "hi", sessionId: "s-hang" }),
    });
    const turnId = await waitForTurnStart(host.url, token, "s-hang");
    const overlap = await fetch(`${host.url}/v1/hooks`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({ text: "again", sessionId: "s-hang" }),
    });
    expect(overlap.status).toBe(409);
    const cancel = await fetch(`${host.url}/v1/turns/${turnId}/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(cancel.status).toBe(404);
    await host.close();
    close = undefined;
    await pending.catch(() => undefined);
  });

  it("returns 409 when a host turn is already in flight on the same session", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-hooks-turns-busy-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-hooks-turns-busy-home-"));
    writeAssembly(workspaceRoot);
    const host = await startHost({ workspaceRoot, homeDir, port: 0 });
    close = host.close;
    const token = loadOrCreateToken(homeDir);
    const models = host.runtime.ctx.require<ModelRegistry>("models");
    models.registerChat("fake", hangChat());
    models.setDefault("chat", "fake");
    const pending = fetch(`${host.url}/v1/turns`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({ sessionId: "s-turns-busy", text: "hi" }),
    });
    await waitForTurnStart(host.url, token, "s-turns-busy");
    const overlap = await fetch(`${host.url}/v1/hooks`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({ text: "again", sessionId: "s-turns-busy" }),
    });
    expect(overlap.status).toBe(409);
    await host.close();
    close = undefined;
    await pending.catch(() => undefined);
  });

  it("cancels an in-flight webhook turn when the client disconnects", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-hooks-abort-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-hooks-abort-home-"));
    writeAssembly(workspaceRoot);
    const host = await startHost({ workspaceRoot, homeDir, port: 0 });
    close = host.close;
    const token = loadOrCreateToken(homeDir);
    const models = host.runtime.ctx.require<ModelRegistry>("models");
    models.registerChat("fake", hangChat());
    models.setDefault("chat", "fake");
    const ac = new AbortController();
    const pending = fetch(`${host.url}/v1/hooks`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({ text: "hi", sessionId: "s-abort" }),
      signal: ac.signal,
    });
    await waitForTurnStart(host.url, token, "s-abort");
    ac.abort();
    await pending.catch(() => undefined);
    const started = Date.now();
    let cancelled = false;
    while (Date.now() - started < 5000) {
      const session = await fetch(`${host.url}/v1/sessions/s-abort`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const log = (await session.json()) as {
        events: { type: string; status?: string }[];
      };
      const end = log.events.find((e) => e.type === "turn/end");
      if (end?.status === "cancelled") {
        cancelled = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(cancelled).toBe(true);
  }, 15_000);

  it("returns 409 while a host turn is awaiting_action", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-hooks-await-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-hooks-await-home-"));
    writeAssembly(workspaceRoot);
    const host = await startHost({ workspaceRoot, homeDir, port: 0 });
    close = host.close;
    const token = loadOrCreateToken(homeDir);
    const models = host.runtime.ctx.require<ModelRegistry>("models");
    models.registerChat("fake", {
      async *stream() {
        yield {
          type: "tool_call",
          id: "c1",
          name: "a2ui_emit",
          args: { messages: confirmMessages() },
        };
      },
    });
    models.setDefault("chat", "fake");
    const turnRes = await fetch(`${host.url}/v1/turns`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({ sessionId: "s-await", text: "show card" }),
    });
    await turnRes.text();
    const hooks = await fetch(`${host.url}/v1/hooks`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({ text: "again", sessionId: "s-await" }),
    });
    expect(hooks.status).toBe(409);
  });
});

describe("host src factory scan", () => {
  it("does not import webhook adapter", () => {
    const srcDir = join(here, "../src");
    const src = readdirSync(srcDir)
      .filter((name) => name.endsWith(".ts"))
      .map((name) => readFileSync(join(srcDir, name), "utf8"))
      .join("\n");
    expect(src).not.toMatch(/@flintloom\/channel-webhook/);
    expect(src).not.toMatch(/createWebhookAdapter/);
    expect(src).not.toMatch(/lastAssistantText/);
  });
});
