import type { IncomingMessage, ServerResponse } from "node:http";
import type { Context } from "@flintloom/kernel";
import type { LoopService, RunTurnResult } from "@flintloom/loop";
import type { Session, SessionEvent } from "@flintloom/session";
import { lastTurnStartId } from "./a2ui.ts";

const MAX_GUARD_BODY = 4096;

export type StreamLoopResultFn = (
  req: IncomingMessage,
  res: ServerResponse,
  session: Session,
  work: (args: {
    signal: AbortSignal;
    onEvent: (event: SessionEvent) => void;
  }) => Promise<RunTurnResult>,
  turnId?: string,
) => Promise<void>;

function send(res: ServerResponse, status: number, body?: string): void {
  res.writeHead(status);
  res.end(body);
}

async function readBodyLimited(
  req: IncomingMessage,
  maxBytes: number,
): Promise<string | "too_large"> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    size += buf.length;
    if (size > maxBytes) {
      req.resume();
      return "too_large";
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseGuardBody(raw: string): { callId: string; decision: "allow" | "deny" } | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      typeof (parsed as { callId?: unknown }).callId === "string" &&
      ((parsed as { decision?: unknown }).decision === "allow" ||
        (parsed as { decision?: unknown }).decision === "deny")
    ) {
      return {
        callId: (parsed as { callId: string }).callId,
        decision: (parsed as { decision: "allow" | "deny" }).decision,
      };
    }
  } catch {
    // invalid JSON
  }
  return undefined;
}

function lastGuardAsk(
  session: Session,
  turnId: string,
): { callId: string } | undefined {
  for (let i = session.events().length - 1; i >= 0; i--) {
    const event = session.events()[i];
    if (event?.type === "guard/ask" && event.turnId === turnId) {
      return { callId: event.callId };
    }
  }
  return undefined;
}

export async function handleTurnGuard(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    pathname: string;
    ctx: Context;
    workspaceRoot: string;
    turns: Map<string, Session>;
    controllers: Map<string, AbortController>;
    busy: Set<string>;
    streamLoopResult: StreamLoopResultFn;
  },
): Promise<boolean> {
  const guardMatch = /^\/v1\/turns\/([^/]+)\/guard$/.exec(opts.pathname);
  if (req.method !== "POST" || !guardMatch) {
    return false;
  }

  const turnId = decodeURIComponent(guardMatch[1]!);
  const raw = await readBodyLimited(req, MAX_GUARD_BODY);
  if (raw === "too_large") {
    send(res, 400);
    return true;
  }
  const body = parseGuardBody(raw);
  if (body === undefined) {
    send(res, 400);
    return true;
  }

  const session = opts.turns.get(turnId);
  const ask = session ? lastGuardAsk(session, turnId) : undefined;
  if (
    session === undefined ||
    !session.isWaiting(turnId) ||
    lastTurnStartId(session) !== turnId ||
    ask === undefined ||
    ask.callId !== body.callId
  ) {
    send(res, 409);
    return true;
  }
  if (opts.controllers.has(turnId)) {
    send(res, 409);
    return true;
  }
  if (opts.busy.has(session.id)) {
    send(res, 409);
    return true;
  }

  opts.busy.add(session.id);
  try {
    await opts.streamLoopResult(
      req,
      res,
      session,
      ({ signal, onEvent }) =>
        opts.ctx.require<LoopService>("loop").continueGuardTurn({
          ctx: opts.ctx,
          session,
          turnId,
          callId: body.callId,
          decision: body.decision,
          workspaceRoot: opts.workspaceRoot,
          channel: "host",
          signal,
          onEvent,
        }),
      turnId,
    );
  } finally {
    opts.busy.delete(session.id);
  }
  return true;
}
