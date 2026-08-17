import type { IncomingMessage, ServerResponse } from "node:http";
import type { Context } from "@flintloom/kernel";
import type { LoopService, RunTurnResult } from "@flintloom/loop";
import type { Session, SessionEvent } from "@flintloom/session";

const MAX_ACTION_BODY = 64 * 1024;

type A2uiService = {
  validateAction(
    action: { surfaceId: string; name: string; context?: unknown; data?: unknown },
    messages: unknown[],
  ): void;
};

type TurnAction = {
  surfaceId: string;
  name: string;
  context?: unknown;
  data?: unknown;
};

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

function parseActionBody(raw: string): TurnAction | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "surfaceId" in parsed &&
      "name" in parsed &&
      typeof (parsed as { surfaceId: unknown }).surfaceId === "string" &&
      typeof (parsed as { name: unknown }).name === "string"
    ) {
      const rec = parsed as {
        surfaceId: string;
        name: string;
        context?: unknown;
        data?: unknown;
      };
      const action: TurnAction = { surfaceId: rec.surfaceId, name: rec.name };
      if ("context" in rec) {
        action.context = rec.context;
      }
      if ("data" in rec) {
        action.data = rec.data;
      }
      return action;
    }
  } catch {
    // invalid JSON
  }
  return undefined;
}

function lastSurfaceMessages(session: Session, turnId: string): unknown[] | undefined {
  const events = session.events();
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event?.type === "a2ui/surface" && event.turnId === turnId) {
      return event.messages;
    }
  }
  return undefined;
}

export function cancelWaitingTurn(session: Session, turnId: string): boolean {
  if (!session.isWaiting(turnId)) {
    return false;
  }
  session.append({ type: "turn/end", turnId, status: "cancelled" });
  return true;
}

export async function handleTurnActions(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    pathname: string;
    ctx: Context;
    workspaceRoot: string;
    turns: Map<string, Session>;
    streamLoopResult: StreamLoopResultFn;
  },
): Promise<boolean> {
  const actionsMatch = /^\/v1\/turns\/([^/]+)\/actions$/.exec(opts.pathname);
  if (req.method !== "POST" || !actionsMatch) {
    return false;
  }

  const a2ui = opts.ctx.get<A2uiService>("a2ui");
  if (a2ui === undefined) {
    send(res, 404);
    return true;
  }

  const turnId = decodeURIComponent(actionsMatch[1]!);
  const raw = await readBodyLimited(req, MAX_ACTION_BODY);
  if (raw === "too_large") {
    send(res, 400);
    return true;
  }
  const action = parseActionBody(raw);
  if (action === undefined) {
    send(res, 400);
    return true;
  }

  const session = opts.turns.get(turnId);
  if (session === undefined || !session.isWaiting(turnId)) {
    send(res, 409);
    return true;
  }

  const messages = lastSurfaceMessages(session, turnId);
  if (messages === undefined) {
    send(res, 409);
    return true;
  }

  try {
    a2ui.validateAction(action, messages);
  } catch {
    send(res, 400);
    return true;
  }

  await opts.streamLoopResult(
    req,
    res,
    session,
    ({ signal, onEvent }) =>
      opts.ctx.require<LoopService>("loop").continueTurn({
        ctx: opts.ctx,
        session,
        turnId,
        action,
        workspaceRoot: opts.workspaceRoot,
        channel: "host",
        signal,
        onEvent,
      }),
    turnId,
  );
  return true;
}
