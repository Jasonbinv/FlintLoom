import type { Context } from "@flintloom/kernel";
import {
  ModelKindMissingError,
  type ChatChunkToolCall,
  type ModelRegistry,
} from "@flintloom/models";
import { Session, type SessionEvent } from "@flintloom/session";
import { isGuardAskError, type ToolRegistry } from "@flintloom/tools";

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

export type ContinueGuardTurnInput = {
  ctx: Context;
  session: Session;
  turnId: string;
  callId: string;
  decision: "allow" | "deny";
  workspaceRoot: string;
  channel: string;
  signal: AbortSignal;
  onEvent?: (event: SessionEvent) => void;
};

export type LoopService = {
  runTurn(input: RunTurnInput): Promise<RunTurnResult>;
  continueTurn(input: ContinueTurnInput): Promise<RunTurnResult>;
  continueGuardTurn(input: ContinueGuardTurnInput): Promise<RunTurnResult>;
};

type RunStepsInput = {
  ctx: Context;
  session: Session;
  turnId: string;
  workspaceRoot: string;
  channel: string;
  signal: AbortSignal;
  onEvent?: (event: SessionEvent) => void;
  pendingToolCalls?: ChatChunkToolCall[];
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

function lastGuardAsk(
  session: Session,
  turnId: string,
): Extract<SessionEvent, { type: "guard/ask" }> | undefined {
  const events = session.events();
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event?.type === "guard/ask" && event.turnId === turnId) {
      return event;
    }
  }
  return undefined;
}

function toolCallById(
  session: Session,
  callId: string,
): Extract<SessionEvent, { type: "tool/call" }> | undefined {
  for (const event of session.events()) {
    if (event.type === "tool/call" && event.callId === callId) {
      return event;
    }
  }
  return undefined;
}

type FinishFn = (status: TurnEndStatus) => Promise<RunTurnResult>;

async function maybeDeliver(
  ctx: Context,
  channel: string,
  session: Session,
  turnId: string,
  signal: AbortSignal,
): Promise<void> {
  if (channel === "host" || channel === "cli") {
    return;
  }
  type DeliverRegistry = {
    has(id: string): boolean;
    deliver(
      id: string,
      outbound: { sessionId: string; turnId: string; signal: AbortSignal },
    ): Promise<void>;
  };
  const channels = ctx.get<DeliverRegistry>("channels");
  if (channels === undefined || !channels.has(channel)) {
    return;
  }
  try {
    await channels.deliver(channel, {
      sessionId: session.id,
      turnId,
      signal,
    });
  } catch (err) {
    if (err instanceof Error && err.message === "no deliver") {
      return;
    }
    throw err;
  }
}

async function failChat(
  session: Session,
  onEvent: RunTurnInput["onEvent"],
  finish: FinishFn,
  err: unknown,
  kind = "chat",
): Promise<RunTurnResult> {
  appendEvent(session, onEvent, {
    type: "model/error",
    kind,
    message: errorMessage(err),
  });
  return await finish("failed");
}

async function executeToolCall(
  input: RunStepsInput,
  call: ChatChunkToolCall,
  stepWait: { value: boolean },
): Promise<RunTurnResult | undefined> {
  const { session, turnId, workspaceRoot, channel, signal, onEvent } = input;
  const tools = input.ctx.require<ToolRegistry>("tools");

  appendEvent(session, onEvent, {
    type: "tool/call",
    callId: call.id,
    name: call.name,
    args: call.args,
  });

  let resultText: string;
  try {
    resultText = await tools.execute(call.name, parseToolArgs(call.args), {
      workspaceRoot,
      signal,
      channel,
    });
  } catch (err) {
    if (signal.aborted) {
      return { turnId, status: "cancelled" } as RunTurnResult;
    }
    if (isGuardAskError(err) && channel === "host") {
      const batch = input.pendingToolCalls ?? [];
      const idx = batch.findIndex((c) => c.id === call.id);
      const remainingCalls =
        idx >= 0
          ? batch.slice(idx + 1).map((c) => ({
              id: c.id,
              name: c.name,
              args: c.args,
            }))
          : [];
      appendEvent(session, onEvent, {
        type: "guard/decision",
        tool: call.name,
        decision: "ask",
      });
      appendEvent(session, onEvent, {
        type: "guard/ask",
        turnId,
        callId: call.id,
        tool: call.name,
        remainingCalls,
      });
      return { turnId, status: "awaiting_action" };
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
        if (snap.wait) {
          stepWait.value = true;
        }
      }
    }
  }

  if (signal.aborted) {
    return { turnId, status: "cancelled" };
  }
  return undefined;
}

async function runStepIterations(input: RunStepsInput): Promise<RunTurnResult> {
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

  const finish = async (status: TurnEndStatus): Promise<RunTurnResult> => {
    appendEvent(session, onEvent, { type: "turn/end", turnId, status });
    await maybeDeliver(input.ctx, channel, session, turnId, signal);
    return { turnId, status };
  };

  for (let step = 0; step < MAX_STEPS; step++) {
    if (signal.aborted) {
      return await finish("cancelled");
    }

    let chat;
    try {
      chat = models.resolveChat();
    } catch (err) {
      if (signal.aborted) {
        return await finish("cancelled");
      }
      if (err instanceof ModelKindMissingError) {
        return await failChat(session, onEvent, finish, err, err.kind);
      }
      return await failChat(session, onEvent, finish, err);
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
          return await finish("cancelled");
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
            return await finish("failed");
        }
      }
    } catch (err) {
      if (signal.aborted) {
        return await finish("cancelled");
      }
      return await failChat(session, onEvent, finish, err);
    }

    if (signal.aborted) {
      return await finish("cancelled");
    }

    if (toolCalls.length === 0) {
      appendEvent(session, onEvent, {
        type: "assistant/message",
        text: accumulatedText,
      });
      return await finish("ok");
    }

    let stepWait = { value: false };
    const batchInput = { ...input, pendingToolCalls: toolCalls };
    for (const call of toolCalls) {
      const paused = await executeToolCall(batchInput, call, stepWait);
      if (paused !== undefined) {
        if (paused.status === "awaiting_action" && accumulatedText.length > 0) {
          appendEvent(session, onEvent, {
            type: "assistant/message",
            text: accumulatedText,
          });
        }
        if (paused.status === "cancelled") {
          return await finish("cancelled");
        }
        return paused;
      }
    }

    if (channel === "host" && stepWait.value) {
      if (accumulatedText.length > 0) {
        appendEvent(session, onEvent, { type: "assistant/message", text: accumulatedText });
      }
      return { turnId, status: "awaiting_action" };
    }
  }

  return await finish("failed");
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

  return runStepIterations({ ...input, turnId });
}

export async function continueGuardTurn(
  input: ContinueGuardTurnInput,
): Promise<RunTurnResult> {
  const { session, turnId, callId, decision, onEvent } = input;

  if (lastTurnStartId(session) !== turnId) {
    throw new Error("not waiting");
  }

  const ask = lastGuardAsk(session, turnId);
  if (ask === undefined || ask.callId !== callId) {
    throw new Error("not waiting");
  }

  const tools = input.ctx.require<ToolRegistry>("tools");
  const call = toolCallById(session, callId);
  if (call === undefined) {
    throw new Error("not waiting");
  }

  appendEvent(session, onEvent, {
    type: "guard/response",
    turnId,
    callId,
    decision,
  });

  let resultText: string;
  if (decision === "deny") {
    resultText = `guard denied: ${call.name}`;
  } else {
    resultText = await tools.execute(call.name, parseToolArgs(call.args), {
      workspaceRoot: input.workspaceRoot,
      signal: input.signal,
      channel: input.channel,
      guardBypass: true,
    });
  }

  appendEvent(session, onEvent, {
    type: "tool/result",
    callId,
    name: call.name,
    text: resultText,
  });

  const stepWait = { value: false };
  for (const remaining of ask.remainingCalls) {
    const paused = await executeToolCall(
      { ...input, turnId },
      {
        type: "tool_call",
        id: remaining.id,
        name: remaining.name,
        args: remaining.args,
      },
      stepWait,
    );
    if (paused !== undefined) {
      if (paused.status === "cancelled") {
        appendEvent(session, onEvent, { type: "turn/end", turnId, status: "cancelled" });
        await maybeDeliver(input.ctx, input.channel, session, turnId, input.signal);
        return paused;
      }
      return paused;
    }
  }

  if (input.channel === "host" && stepWait.value) {
    return { turnId, status: "awaiting_action" };
  }

  return runStepIterations({ ...input, turnId });
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

  return runStepIterations({ ...input, turnId });
}
