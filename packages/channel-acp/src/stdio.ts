import { createInterface } from "node:readline";
import type { Context } from "@flintloom/kernel";
import type { LoopService } from "@flintloom/loop";
import type { SessionEvent, SessionStore } from "@flintloom/session";

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number;
  method?: string;
  params?: unknown;
};

type AcpState = {
  controllers: Map<string, AbortController>;
  promptControllers: Map<string, AbortController>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function promptText(prompt: unknown): string {
  if (!Array.isArray(prompt)) {
    return "";
  }
  const parts: string[] = [];
  for (const block of prompt) {
    if (!isRecord(block) || block.type !== "text") {
      continue;
    }
    if (typeof block.text === "string") {
      parts.push(block.text);
    }
  }
  return parts.join("\n").trim();
}

function writeStdout(msg: unknown): void {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function writeNotification(method: string, params: unknown): void {
  writeStdout({ jsonrpc: "2.0", method, params });
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
    return {
      protocolVersion: 1,
      agentCapabilities: {
        promptCapabilities: {
          image: false,
          audio: false,
          embeddedContext: false,
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
    return undefined;
  }

  if (method === "session/prompt") {
    const sessions = ctx.require<SessionStore>("sessions");
    const loop = ctx.require<LoopService>("loop");
    const params = req.params;
    if (!isRecord(params) || typeof params.sessionId !== "string") {
      throw new Error("sessionId");
    }
    const text = promptText(params.prompt);
    if (text.length === 0) {
      throw new Error("prompt");
    }
    const sessionId = params.sessionId;
    const session = sessions.getOrCreate(sessionId);
    const ac = new AbortController();
    state.promptControllers.set(sessionId, ac);
    try {
      const result = await loop.runTurn({
        ctx,
        session,
        text,
        workspaceRoot,
        channel: "acp",
        signal: ac.signal,
        onEvent(event: SessionEvent) {
          if (event.type === "assistant/chunk") {
            writeNotification("session/update", {
              sessionId,
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: event.text },
              },
            });
          }
        },
      });
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
  const state: AcpState = {
    controllers: new Map(),
    promptControllers: new Map(),
  };
  const reader = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of reader) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    let req: JsonRpcRequest;
    try {
      req = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      continue;
    }
    if (req.id === undefined) {
      try {
        await handleAcpRequest(ctx, workspaceRoot, req, state);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(message + "\n");
      }
      continue;
    }
    try {
      const result = await handleAcpRequest(ctx, workspaceRoot, req, state);
      writeStdout({ jsonrpc: "2.0", id: req.id, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      writeStdout({
        jsonrpc: "2.0",
        id: req.id,
        error: { code: -32603, message },
      });
    }
  }
}
