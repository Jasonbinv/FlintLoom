import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { Context } from "@flintloom/kernel";
import { Session } from "@flintloom/session";
import { lastTurnStartId } from "../src/a2ui.ts";
import { handleTurnGuard } from "../src/guard.ts";

function guardWaitingSession(turnId = "t1", callId = "call-1"): Session {
  const session = new Session("s");
  session.append({ type: "turn/start", turnId });
  session.append({ type: "tool/call", callId, name: "touch", args: {} });
  session.append({
    type: "guard/decision",
    tool: "touch",
    decision: "ask",
  });
  session.append({
    type: "guard/ask",
    turnId,
    callId,
    tool: "touch",
    remainingCalls: [],
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

function guardReq(body: unknown): IncomingMessage {
  const req = Readable.from([JSON.stringify(body)]) as IncomingMessage;
  Object.assign(req, { method: "POST" });
  return req;
}

describe("guard HTTP", () => {
  it("handleTurnGuard returns 409 when callId mismatches or session not waiting", async () => {
    const session = guardWaitingSession("t1", "call-1");
    const turns = new Map<string, Session>([["t1", session]]);
    const streamFn = vi.fn(async () => undefined);
    const ctx = new Context();
    ctx.provide("loop", {
      continueGuardTurn: async () => ({ turnId: "t1", status: "ok" }),
    });

    const wrongCall = mockRes();
    expect(
      await handleTurnGuard(
        guardReq({ callId: "other", decision: "allow" }),
        wrongCall.res,
        {
          pathname: "/v1/turns/t1/guard",
          ctx,
          workspaceRoot: "/tmp",
          turns,
          controllers: new Map<string, AbortController>(),
          busy: new Set<string>(),
          streamLoopResult: streamFn,
        },
      ),
    ).toBe(true);
    expect(wrongCall.state.status).toBe(409);
    expect(streamFn).not.toHaveBeenCalled();

    session.append({ type: "turn/start", turnId: "t-new" });
    const stale = mockRes();
    expect(
      await handleTurnGuard(
        guardReq({ callId: "call-1", decision: "allow" }),
        stale.res,
        {
          pathname: "/v1/turns/t1/guard",
          ctx,
          workspaceRoot: "/tmp",
          turns,
          controllers: new Map<string, AbortController>(),
          busy: new Set<string>(),
          streamLoopResult: streamFn,
        },
      ),
    ).toBe(true);
    expect(stale.state.status).toBe(409);
    expect(lastTurnStartId(session)).toBe("t-new");
  });

  it("handleTurnGuard returns 409 when a controller exists or session busy", async () => {
    const session = guardWaitingSession("t1", "call-1");
    const turns = new Map<string, Session>([["t1", session]]);
    const streamFn = vi.fn(async () => undefined);
    const ctx = new Context();
    ctx.provide("loop", {
      continueGuardTurn: async () => ({ turnId: "t1", status: "ok" }),
    });
    const controllers = new Map<string, AbortController>();
    controllers.set("t1", new AbortController());

    const busyController = mockRes();
    expect(
      await handleTurnGuard(
        guardReq({ callId: "call-1", decision: "allow" }),
        busyController.res,
        {
          pathname: "/v1/turns/t1/guard",
          ctx,
          workspaceRoot: "/tmp",
          turns,
          controllers,
          busy: new Set<string>(),
          streamLoopResult: streamFn,
        },
      ),
    ).toBe(true);
    expect(busyController.state.status).toBe(409);

    controllers.delete("t1");
    const busySession = mockRes();
    const busy = new Set<string>([session.id]);
    expect(
      await handleTurnGuard(
        guardReq({ callId: "call-1", decision: "allow" }),
        busySession.res,
        {
          pathname: "/v1/turns/t1/guard",
          ctx,
          workspaceRoot: "/tmp",
          turns,
          controllers,
          busy,
          streamLoopResult: streamFn,
        },
      ),
    ).toBe(true);
    expect(busySession.state.status).toBe(409);
    expect(streamFn).not.toHaveBeenCalled();
  });

  it("handleTurnGuard returns 400 for invalid body", async () => {
    const session = guardWaitingSession();
    const turns = new Map<string, Session>([["t1", session]]);
    const bad = mockRes();
    expect(
      await handleTurnGuard(
        guardReq({ callId: "call-1", decision: "maybe" }),
        bad.res,
        {
          pathname: "/v1/turns/t1/guard",
          ctx: new Context(),
          workspaceRoot: "/tmp",
          turns,
          controllers: new Map<string, AbortController>(),
          busy: new Set<string>(),
          streamLoopResult: vi.fn(),
        },
      ),
    ).toBe(true);
    expect(bad.state.status).toBe(400);
  });

  it("handleTurnGuard streams allow continuation", async () => {
    const session = guardWaitingSession("t1", "call-1");
    const turns = new Map<string, Session>([["t1", session]]);
    const streamFn = vi.fn(async (_req, _res, _session, work) => {
      await work({
        signal: new AbortController().signal,
        onEvent: () => undefined,
      });
    });
    const ctx = new Context();
    const continueGuardTurn = vi.fn(async () => ({
      turnId: "t1",
      status: "ok" as const,
    }));
    ctx.provide("loop", { continueGuardTurn });

    const { res } = mockRes();
    expect(
      await handleTurnGuard(
        guardReq({ callId: "call-1", decision: "allow" }),
        res,
        {
          pathname: "/v1/turns/t1/guard",
          ctx,
          workspaceRoot: "/tmp",
          turns,
          controllers: new Map<string, AbortController>(),
          busy: new Set<string>(),
          streamLoopResult: streamFn,
        },
      ),
    ).toBe(true);
    expect(continueGuardTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        turnId: "t1",
        callId: "call-1",
        decision: "allow",
        channel: "host",
      }),
    );
    expect(streamFn).toHaveBeenCalled();
  });
});
