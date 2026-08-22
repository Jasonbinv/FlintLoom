import type { Session } from "@flintloom/session";
import type { LoopService } from "@flintloom/loop";
import { AcpClientRpc } from "./client-rpc.ts";
import { acpToolKind } from "./updates.ts";

type GuardAsk = {
  turnId: string;
  callId: string;
  tool: string;
};

export function pendingGuardAsk(session: Session, turnId: string): GuardAsk | undefined {
  const pending = new Map<string, { tool: string }>();
  for (const event of session.events()) {
    if (event.type === "turn/start" && event.turnId === turnId) {
      pending.clear();
    } else if (event.type === "turn/end" && event.turnId === turnId) {
      pending.clear();
    } else if (event.type === "guard/ask" && event.turnId === turnId) {
      pending.set(event.callId, { tool: event.tool });
    } else if (event.type === "guard/response" && event.turnId === turnId) {
      pending.delete(event.callId);
    }
  }
  const first = [...pending.entries()][0];
  if (first === undefined) {
    return undefined;
  }
  return { turnId, callId: first[0], tool: first[1].tool };
}

export async function resolveAcpGuardAsks(opts: {
  session: Session;
  sessionId: string;
  turnId: string;
  loop: LoopService;
  ctx: import("@flintloom/kernel").Context;
  workspaceRoot: string;
  signal: AbortSignal;
  clientRpc: AcpClientRpc;
  writeStdout: (msg: unknown) => void;
  onEvent?: (event: import("@flintloom/session").SessionEvent) => void;
}): Promise<import("@flintloom/loop").RunTurnResult> {
  let ask = pendingGuardAsk(opts.session, opts.turnId);
  if (ask === undefined) {
    return { turnId: opts.turnId, status: "awaiting_action" };
  }
  while (ask !== undefined) {
    const response = (await opts.clientRpc.request(
      "session/request_permission",
      {
        sessionId: opts.sessionId,
        toolCall: {
          toolCallId: ask.callId,
          title: ask.tool,
          kind: acpToolKind(ask.tool, {}),
          status: "pending",
        },
        options: [
          { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
          { optionId: "reject-once", name: "Reject", kind: "reject_once" },
        ],
      },
      opts.writeStdout,
    )) as { outcome?: { outcome?: string; optionId?: string } };

    const outcome = response?.outcome?.outcome;
    if (outcome === "cancelled" || opts.signal.aborted) {
      return { turnId: opts.turnId, status: "cancelled" };
    }
    const decision =
      outcome === "selected" && response.outcome?.optionId === "allow-once"
        ? "allow"
        : "deny";
    const result = await opts.loop.continueGuardTurn({
      ctx: opts.ctx,
      session: opts.session,
      turnId: opts.turnId,
      callId: ask.callId,
      decision,
      workspaceRoot: opts.workspaceRoot,
      channel: "acp",
      signal: opts.signal,
      onEvent: opts.onEvent,
    });
    if (result.status !== "awaiting_action") {
      return result;
    }
    ask = pendingGuardAsk(opts.session, opts.turnId);
  }
  return { turnId: opts.turnId, status: "ok" };
}
