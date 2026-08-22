import { createInterface } from "node:readline";
import type { Context } from "@flintloom/kernel";
import type { LoopService } from "@flintloom/loop";
import type { SessionEvent, SessionStore } from "@flintloom/session";
import { AcpClientRpc } from "./client-rpc.ts";
import { pendingGuardAsk, resolveAcpGuardAsks } from "./guard.ts";
import { promptCapabilities, promptContent } from "./prompt.ts";
import { emitAcpSessionEvent } from "./updates.ts";

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message?: string };
};

type AcpState = {
  controllers: Map<string, AbortController>;
  promptControllers: Map<string, AbortController>;
  clientRpc: AcpClientRpc;
  writeStdout: (msg: unknown) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function handleAcpRequest(
  ctx: Context,
  workspaceRoot: string,
  req: JsonRpcRequest,
  state: AcpState,
): Promise<unknown | undefined> {
  const method = req.method;
  if (method === undefined) {
    return undefined;
  }

  if (method === "initialize") {
    const caps = promptCapabilities(ctx);
    return {
      protocolVersion: 1,
      agentCapabilities: {
        promptCapabilities: {
          image: caps.image,
          audio: caps.audio,
          embeddedContext: caps.embeddedContext,
        },
      },
      agentInfo: {
        name: "flintloom",
        title: "FlintLoom",
        version: "0.1.0",
      },
      authMethods: [],
    };
  }

  if (method === "session/new") {
    const sessions = ctx.require<SessionStore>("sessions");
    const sessionId = crypto.randomUUID();
    sessions.getOrCreate(sessionId);
    return { sessionId };
  }

  if (method === "session/cancel") {
    const params = req.params;
    if (!isRecord(params) || typeof params.sessionId !== "string") {
      return undefined;
    }
    const ac = state.promptControllers.get(params.sessionId);
    if (ac !== undefined) {
      ac.abort();
    }
    state.clientRpc.cancelAll();
    return undefined;
  }

  if (method === "session/prompt") {
    const sessions = ctx.require<SessionStore>("sessions");
    const loop = ctx.require<LoopService>("loop");
    const params = req.params;
    if (!isRecord(params) || typeof params.sessionId !== "string") {
      throw new Error("sessionId");
    }
    const sessionId = params.sessionId;
    const ac = new AbortController();
    state.promptControllers.set(sessionId, ac);
    const content = await promptContent(ctx, params.prompt, ac.signal);
    if (content === undefined) {
      throw new Error("prompt");
    }
    const session = sessions.getOrCreate(sessionId);
    try {
      let result = await loop.runTurn({
        ctx,
        session,
        text: content.text,
        images: content.images,
        workspaceRoot,
        channel: "acp",
        signal: ac.signal,
        onEvent(event: SessionEvent) {
          emitAcpSessionEvent(sessionId, event, (m, p) =>
            state.writeStdout({ jsonrpc: "2.0", method: m, params: p }),
          );
        },
      });
      if (
        result.status === "awaiting_action" &&
        pendingGuardAsk(session, result.turnId) !== undefined
      ) {
        const onEvent = (event: SessionEvent) => {
          emitAcpSessionEvent(sessionId, event, (m, p) =>
            state.writeStdout({ jsonrpc: "2.0", method: m, params: p }),
          );
        };
        result = await resolveAcpGuardAsks({
          session,
          sessionId,
          turnId: result.turnId,
          loop,
          ctx,
          workspaceRoot,
          signal: ac.signal,
          clientRpc: state.clientRpc,
          writeStdout: state.writeStdout,
          onEvent,
        });
      }
      const stopReason =
        result.status === "cancelled"
          ? "cancelled"
          : result.status === "failed"
            ? "refusal"
            : "end_turn";
      return { stopReason };
    } finally {
      state.promptControllers.delete(sessionId);
    }
  }

  throw new Error(method);
}

export async function runAcpStdio(ctx: Context, workspaceRoot: string): Promise<void> {
  const clientRpc = new AcpClientRpc();
  const writeStdout = (msg: unknown): void => {
    process.stdout.write(`${JSON.stringify(msg)}\n`);
  };
  const state: AcpState = {
    controllers: new Map(),
    promptControllers: new Map(),
    clientRpc,
    writeStdout,
  };
  const reader = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of reader) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    let msg: JsonRpcRequest;
    try {
      msg = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      continue;
    }
    if (msg.method === undefined) {
      if (clientRpc.handleResponse(msg)) {
        continue;
      }
      continue;
    }
    if (msg.id === undefined) {
      try {
        await handleAcpRequest(ctx, workspaceRoot, msg, state);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(message + "\n");
      }
      continue;
    }
    try {
      const result = await handleAcpRequest(ctx, workspaceRoot, msg, state);
      writeStdout({ jsonrpc: "2.0", id: msg.id, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      writeStdout({
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: -32603, message },
      });
    }
  }
}
