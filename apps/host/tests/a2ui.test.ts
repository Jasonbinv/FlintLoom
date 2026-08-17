import { EventEmitter } from "node:events";
import { mkdtempSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Context } from "@flintloom/kernel";
import { Session } from "@flintloom/session";
import {
  cancelWaitingTurn,
  handleTurnActions,
  lastTurnStartId,
  sessionHasWaitingTurn,
} from "../src/a2ui.ts";
import { loadOrCreateToken, startHost } from "../src/index.ts";
import { streamLoopResult } from "../src/server.ts";

// LLM pause/continue is covered by packages/loop; this file covers host HTTP 401/404 and waiting cancel.

function waitingSession(turnId = "t1"): Session {
  const session = new Session("s");
  session.append({ type: "turn/start", turnId });
  session.append({
    type: "a2ui/surface",
    turnId,
    surfaceId: "main",
    wait: true,
    messages: [
      { version: "v0.9", createSurface: { surfaceId: "main", catalogId: "flintloom:a2ui:core" } },
    ],
  });
  return session;
}

function mockRes() {
  const state = {
    status: 0,
    body: "",
    chunks: [] as string[],
    headersSent: false,
    writableEnded: false,
  };
  const res = {
    get headersSent() {
      return state.headersSent;
    },
    get writableEnded() {
      return state.writableEnded;
    },
    writeHead(status: number) {
      state.status = status;
      state.headersSent = true;
      return this;
    },
    write(chunk: string) {
      state.chunks.push(chunk);
      return true;
    },
    end(chunk?: string) {
      if (typeof chunk === "string") state.body = chunk;
      state.writableEnded = true;
    },
  };
  return { res: res as unknown as ServerResponse, state };
}

function actionReq(body: unknown): IncomingMessage {
  const req = Readable.from([JSON.stringify(body)]) as IncomingMessage;
  Object.assign(req, { method: "POST" });
  return req;
}

class MockReq extends EventEmitter {
  method = "POST";
}

describe("a2ui HTTP", () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    if (close) {
      await close();
      close = undefined;
    }
  });

  it("cancelWaitingTurn appends turn/end cancelled", () => {
    const session = new Session("s");
    session.append({ type: "turn/start", turnId: "t1" });
    session.append({
      type: "a2ui/surface",
      turnId: "t1",
      surfaceId: "main",
      wait: true,
      messages: [],
    });
    expect(cancelWaitingTurn(session, "t1")).toBe(true);
    expect(session.events().some((e) => e.type === "turn/end" && e.status === "cancelled")).toBe(true);
    expect(cancelWaitingTurn(session, "t1")).toBe(false);
  });

  it("sessionHasWaitingTurn scans events and lastTurnStartId is the latest start", () => {
    const session = waitingSession("t-wait");
    expect(sessionHasWaitingTurn(session)).toBe(true);
    expect(lastTurnStartId(session)).toBe("t-wait");
    session.append({ type: "turn/start", turnId: "t-next" });
    expect(lastTurnStartId(session)).toBe("t-next");
    expect(session.isWaiting("t-wait")).toBe(true);
    expect(sessionHasWaitingTurn(session)).toBe(true);
    session.append({ type: "turn/end", turnId: "t-wait", status: "cancelled" });
    expect(sessionHasWaitingTurn(session)).toBe(false);
  });

  it("handleTurnActions returns 409 when lastTurnStartId does not match or a controller exists", async () => {
    const session = waitingSession("t-old");
    session.append({ type: "turn/start", turnId: "t-new" });
    const turns = new Map<string, Session>([["t-old", session]]);
    const controllers = new Map<string, AbortController>();
    const streamFn = vi.fn(async () => undefined);
    const ctx = new Context();
    ctx.provide("a2ui", { validateAction() {} });
    ctx.provide("loop", { continueTurn: async () => ({ turnId: "t-old", status: "ok" }) });

    const stale = mockRes();
    expect(
      await handleTurnActions(actionReq({ surfaceId: "main", name: "confirm" }), stale.res, {
        pathname: "/v1/turns/t-old/actions",
        ctx,
        workspaceRoot: "/tmp",
        turns,
        controllers,
        streamLoopResult: streamFn,
      }),
    ).toBe(true);
    expect(stale.state.status).toBe(409);
    expect(streamFn).not.toHaveBeenCalled();

    const waiting = waitingSession("t1");
    turns.set("t1", waiting);
    controllers.set("t1", new AbortController());
    const busy = mockRes();
    expect(
      await handleTurnActions(actionReq({ surfaceId: "main", name: "confirm" }), busy.res, {
        pathname: "/v1/turns/t1/actions",
        ctx,
        workspaceRoot: "/tmp",
        turns,
        controllers,
        streamLoopResult: streamFn,
      }),
    ).toBe(true);
    expect(busy.state.status).toBe(409);
    expect(streamFn).not.toHaveBeenCalled();
  });

  it("streamLoopResult maps not-waiting to 409 and does not overwrite another controller", async () => {
    const session = waitingSession("t1");
    const controllers = new Map<string, AbortController>();
    const turns = new Map<string, Session>();
    const other = new AbortController();
    controllers.set("t1", other);

    const conflict = mockRes();
    await streamLoopResult(
      new MockReq() as unknown as IncomingMessage,
      conflict.res,
      session,
      controllers,
      turns,
      async () => ({ turnId: "t1", status: "ok" }),
      "t1",
    );
    expect(conflict.state.status).toBe(409);
    expect(controllers.get("t1")).toBe(other);

    const thrown = mockRes();
    const emptyControllers = new Map<string, AbortController>();
    await streamLoopResult(
      new MockReq() as unknown as IncomingMessage,
      thrown.res,
      session,
      emptyControllers,
      turns,
      async () => {
        throw new Error("not waiting");
      },
      "t1",
    );
    expect(thrown.state.status).toBe(409);
    expect(emptyControllers.has("t1")).toBe(false);
  });

  it("streamLoopResult keeps wait when work throws after headers and deletes only this controller", async () => {
    const session = waitingSession("t1");
    const controllers = new Map<string, AbortController>();
    const turns = new Map<string, Session>([["t1", session]]);
    const other = new AbortController();
    const req = new MockReq() as unknown as IncomingMessage;
    const { res, state } = mockRes();

    await streamLoopResult(
      req,
      res,
      session,
      controllers,
      turns,
      async ({ onEvent }) => {
        onEvent({
          type: "a2ui/surface",
          turnId: "t1",
          surfaceId: "main",
          wait: true,
          messages: [],
        });
        controllers.set("t1", other);
        throw new Error("boom");
      },
      "t1",
    );

    const payload = state.chunks.join("");
    expect(payload).toContain('"type":"model/error"');
    expect(payload).toContain('"status":"awaiting_action"');
    expect(payload).not.toContain('"status":"failed"');
    expect(session.isWaiting("t1")).toBe(true);
    expect(controllers.get("t1")).toBe(other);
  });

  it("streamLoopResult writes end failed when work throws after headers and the turn is not waiting", async () => {
    const session = new Session("s");
    session.append({ type: "turn/start", turnId: "t1" });
    const controllers = new Map<string, AbortController>();
    const turns = new Map<string, Session>();
    const { res, state } = mockRes();

    await streamLoopResult(
      new MockReq() as unknown as IncomingMessage,
      res,
      session,
      controllers,
      turns,
      async ({ onEvent }) => {
        onEvent({ type: "turn/start", turnId: "t1" });
        throw new Error("boom");
      },
    );

    const payload = state.chunks.join("");
    expect(state.status).toBe(200);
    expect(payload).toContain('"status":"failed"');
    expect(session.isWaiting("t1")).toBe(false);
  });

  it("returns 401 without bearer and 404 when a2ui plugin omitted", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-a2ui-http-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-a2ui-http-home-"));
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
    const unauth = await fetch(`${host.url}/v1/turns/t1/actions`, { method: "POST" });
    expect(unauth.status).toBe(401);
    const token = loadOrCreateToken(homeDir);
    const res = await fetch(`${host.url}/v1/turns/t1/actions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ surfaceId: "main", name: "confirm" }),
    });
    expect(res.status).toBe(404);
  });
});
