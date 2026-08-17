import type { Context } from "@flintloom/kernel";
import {
  ModelKindMissingError,
  type ChatChunkToolCall,
  type ModelRegistry,
} from "@flintloom/models";
import { Session, type SessionEvent } from "@flintloom/session";
import type { ToolRegistry } from "@flintloom/tools";

const SYSTEM_MESSAGE =
  "You are FlintLoom, a real agent. Use tools to work in the workspace.";
const MAX_STEPS = 8;

type A2uiLoopService = {
  takeEmit(emitId: string): { surfaceId: string; wait: boolean; messages: unknown[] } | undefined;
  validateAction(
    action: { surfaceId: string; name: string; context?: unknown; data?: unknown },
    messages: unknown[],
  ): void;
};

export interface RunTurnInput {
  ctx: Context;
  session: Session;
  text: string;
  workspaceRoot: string;
  channel: string;
  signal: AbortSignal;
  onEvent?: (event: SessionEvent) => void;
}

export type RunTurnResult = { turnId: string; status: "ok" | "failed" | "cancelled" | "awaiting_action" };

export type ContinueTurnInput = {
  ctx: Context;
  session: Session;
  turnId: string;
  action: { surfaceId: string; name: string; context?: unknown; data?: unknown };
  workspaceRoot: string;
  channel: string;
  signal: AbortSignal;
  onEvent?: (event: SessionEvent) => void;
};

export type LoopService = {
  runTurn(input: RunTurnInput): Promise<RunTurnResult>;
  continueTurn(input: ContinueTurnInput): Promise<RunTurnResult>;
};

type RunStepsInput = {
  ctx: Context;
  session: Session;
  turnId: string;
  workspaceRoot: string;
  channel: string;
  signal: AbortSignal;
  onEvent?: (event: SessionEvent) => void;
};

type TurnEndStatus = Exclude<RunTurnResult["status"], "awaiting_action">;

function appendEvent(
  session: Session,
  onEvent: RunTurnInput["onEvent"],
  event: SessionEvent,
): void {
  session.append(event);
  onEvent?.(event);
}

function parseToolArgs(args: unknown): Record<string, unknown> {
  if (typeof args === "string") {
    return JSON.parse(args) as Record<string, unknown>;
  }
  return args as Record<string, unknown>;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function failChat(
  session: Session,
  onEvent: RunTurnInput["onEvent"],
  finish: (status: TurnEndStatus) => RunTurnResult,
  err: unknown,
  kind = "chat",
): RunTurnResult {
  appendEvent(session, onEvent, {
    type: "model/error",
    kind,
    message: errorMessage(err),
  });
  return finish("failed");
}

function lastTurnStartId(session: Session): string | undefined {
  const events = session.events();
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event?.type === "turn/start") {
      return event.turnId;
    }
  }
  return undefined;
}

function lastSurfaceForTurn(
  session: Session,
  turnId: string,
): Extract<SessionEvent, { type: "a2ui/surface" }> | undefined {
  const events = session.events();
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event?.type === "a2ui/surface" && event.turnId === turnId) {
      return event;
    }
  }
  return undefined;
}

async function runSteps(input: RunStepsInput): Promise<RunTurnResult> {
  const models = input.ctx.require<ModelRegistry>("models");
  const tools = input.ctx.require<ToolRegistry>("tools");
  const {
    session,
    turnId,
    workspaceRoot,
    channel,
    signal,
    onEvent,
  } = input;

  const finish = (status: TurnEndStatus): RunTurnResult => {
    appendEvent(session, onEvent, { type: "turn/end", turnId, status });
    return { turnId, status };
  };

  for (let step = 0; step < MAX_STEPS; step++) {
    if (signal.aborted) {
      return finish("cancelled");
    }

    let chat;
    try {
      chat = models.resolveChat();
    } catch (err) {
      if (signal.aborted) {
        return finish("cancelled");
      }
      if (err instanceof ModelKindMissingError) {
        return failChat(session, onEvent, finish, err, err.kind);
      }
      return failChat(session, onEvent, finish, err);
    }

    const messages = [
      { role: "system" as const, content: SYSTEM_MESSAGE },
      ...session.deriveMessages(),
    ];

    let accumulatedText = "";
    const toolCalls: ChatChunkToolCall[] = [];

    try {
      for await (const chunk of chat.stream(
        { messages, tools: tools.schemas() },
        signal,
      )) {
        if (signal.aborted) {
          return finish("cancelled");
        }

        switch (chunk.type) {
          case "text":
            accumulatedText += chunk.text;
            appendEvent(session, onEvent, {
              type: "assistant/chunk",
              text: chunk.text,
            });
            break;
          case "tool_call":
            toolCalls.push(chunk);
            break;
          case "error":
            appendEvent(session, onEvent, {
              type: "model/error",
              kind: "chat",
              message: chunk.message,
            });
            return finish("failed");
        }
      }
    } catch (err) {
      if (signal.aborted) {
        return finish("cancelled");
      }
      return failChat(session, onEvent, finish, err);
    }

    if (signal.aborted) {
      return finish("cancelled");
    }

    if (toolCalls.length === 0) {
      appendEvent(session, onEvent, {
        type: "assistant/message",
        text: accumulatedText,
      });
      return finish("ok");
    }

    let stepWait = false;
    for (const call of toolCalls) {
      appendEvent(session, onEvent, {
        type: "tool/call",
        callId: call.id,
        name: call.name,
        args: call.args,
      });

      let resultText: string;
      try {
        resultText = await tools.execute(
          call.name,
          parseToolArgs(call.args),
          { workspaceRoot, signal, channel },
        );
      } catch (err) {
        if (signal.aborted) {
          return finish("cancelled");
        }
        resultText = err instanceof Error ? err.message : String(err);
      }

      appendEvent(session, onEvent, {
        type: "tool/result",
        callId: call.id,
        name: call.name,
        text: resultText,
      });

      if (call.name === "a2ui_emit") {
        let parsed: { status?: string; emitId?: string; wait?: boolean; surfaceId?: string };
        try {
          parsed = JSON.parse(resultText) as typeof parsed;
        } catch {
          parsed = {};
        }
        const a2ui = input.ctx.get<A2uiLoopService>("a2ui");
        if (parsed.status === "ok" && typeof parsed.emitId === "string" && a2ui) {
          const snap = a2ui.takeEmit(parsed.emitId);
          if (snap) {
            appendEvent(session, onEvent, {
              type: "a2ui/surface",
              turnId,
              surfaceId: snap.surfaceId,
              messages: snap.messages,
              wait: snap.wait,
            });
            if (snap.wait) stepWait = true;
          }
        }
      }

      if (signal.aborted) {
        return finish("cancelled");
      }
    }

    if (channel === "host" && stepWait) {
      if (accumulatedText.length > 0) {
        appendEvent(session, onEvent, { type: "assistant/message", text: accumulatedText });
      }
      return { turnId, status: "awaiting_action" };
    }
  }

  return finish("failed");
}

export async function runTurn(input: RunTurnInput): Promise<RunTurnResult> {
  input.ctx.require<ModelRegistry>("models");
  input.ctx.require<ToolRegistry>("tools");
  const {
    session,
    text,
    onEvent,
  } = input;

  const turnId = crypto.randomUUID();
  appendEvent(session, onEvent, { type: "turn/start", turnId });
  appendEvent(session, onEvent, { type: "user/message", text });

  return runSteps({ ...input, turnId });
}

export async function continueTurn(input: ContinueTurnInput): Promise<RunTurnResult> {
  const { session, turnId, action, onEvent } = input;

  if (!session.isWaiting(turnId) || lastTurnStartId(session) !== turnId) {
    throw new Error("not waiting");
  }

  const a2ui = input.ctx.get<A2uiLoopService>("a2ui");
  if (!a2ui) {
    throw new Error("not waiting");
  }

  const surface = lastSurfaceForTurn(session, turnId);
  if (!surface) {
    throw new Error("not waiting");
  }

  a2ui.validateAction(action, surface.messages);
  appendEvent(session, onEvent, {
    type: "a2ui/action",
    turnId,
    surfaceId: action.surfaceId,
    name: action.name,
    ...(action.context !== undefined ? { context: action.context } : {}),
    ...(action.data !== undefined ? { data: action.data } : {}),
  });

  return runSteps({ ...input, turnId });
}
