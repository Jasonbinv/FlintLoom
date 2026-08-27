import type { Context } from "@flintloom/kernel";
import {
  ModelKindMissingError,
  type ChatChunkToolCall,
  type ModelRegistry,
} from "@flintloom/models";
import { Session, type SessionEvent, type UserImage } from "@flintloom/session";
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
  images?: UserImage[];
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
  startedAt: number;
  workspaceRoot: string;
  channel: string;
  signal: AbortSignal;
  onEvent?: (event: SessionEvent) => void;
  pendingToolCalls?: ChatChunkToolCall[];
};

type TurnEndStatus = Exclude<RunTurnResult["status"], "awaiting_action">;

type TurnGuardStats = {
  allow: number;
  deny: number;
  ask: number;
  suspicious: number;
};

function emptyGuardStats(): TurnGuardStats {
  return { allow: 0, deny: 0, ask: 0, suspicious: 0 };
}

function computeTurnStats(
  session: Session,
  turnId: string,
  startedAt: number,
): Extract<SessionEvent, { type: "turn/stats" }> {
  const guard = emptyGuardStats();
  let steps = 0;
  let toolCalls = 0;
  let llmMs = 0;
  let toolMs = 0;
  let ttftMs = 0;
  let ttftSteps = 0;
  let decodeMs = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let inTurn = false;

  for (const event of session.events()) {
    if (event.type === "turn/start" && event.turnId === turnId) {
      inTurn = true;
      continue;
    }
    if (!inTurn) {
      continue;
    }
    if (event.type === "turn/end" && event.turnId === turnId) {
      break;
    }
    if (event.type === "step/start" && event.turnId === turnId) {
      steps += 1;
    }
    if (event.type === "step/stats" && event.turnId === turnId) {
      llmMs += event.llmMs;
      inputTokens += event.inputTokens;
      outputTokens += event.outputTokens;
      cacheReadTokens += event.cacheReadTokens;
      if (event.ttftMs !== undefined) {
        ttftMs += event.ttftMs;
        ttftSteps += 1;
      }
      if (event.decodeMs !== undefined) {
        decodeMs += event.decodeMs;
      }
    }
    if (event.type === "tool/call") {
      toolCalls += 1;
    }
    if (event.type === "tool/result" && event.durationMs !== undefined) {
      toolMs += event.durationMs;
    }
    if (event.type === "guard/decision") {
      if (event.decision === "allow") guard.allow += 1;
      if (event.decision === "deny") guard.deny += 1;
      if (event.decision === "ask") guard.ask += 1;
    }
    if (event.type === "guard/response") {
      if (event.decision === "allow") guard.allow += 1;
      else guard.deny += 1;
    }
    if (event.type === "guard/steward" && event.verdict === "suspicious") {
      guard.suspicious += 1;
    }
    if (event.type === "tool/result" && event.text.startsWith("guard denied:")) {
      guard.deny += 1;
    }
  }

  return {
    type: "turn/stats",
    turnId,
    steps,
    toolCalls,
    durationMs: Math.max(0, Date.now() - startedAt),
    llmMs,
    toolMs,
    ttftMs,
    ttftSteps,
    decodeMs,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    guard,
  };
}

function emitTurnStats(
  session: Session,
  onEvent: RunTurnInput["onEvent"],
  turnId: string,
  startedAt: number,
): void {
  appendEvent(session, onEvent, computeTurnStats(session, turnId, startedAt));
}

function appendEvent(
  session: Session,
  onEvent: RunTurnInput["onEvent"],
  event: SessionEvent,
): void {
  session.append(event);
  onEvent?.(event);
}

function turnStartedAt(session: Session, turnId: string): number {
  for (const event of session.events()) {
    if (event.type === "turn/start" && event.turnId === turnId) {
      return event.startedAt;
    }
  }
  return Date.now();
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

const STEWARD_RESULT_MAX = 2000;

function shouldSteward(resultText: string): boolean {
  return !resultText.startsWith("guard denied:");
}

async function maybeAppendGuardSteward(
  ctx: Context,
  session: Session,
  onEvent: RunTurnInput["onEvent"],
  callId: string,
  tool: string,
  args: unknown,
  resultText: string,
  workspaceRoot: string,
  channel: string,
  signal: AbortSignal,
): Promise<void> {
  if (!shouldSteward(resultText)) {
    return;
  }
  const guard = ctx.require<ModelRegistry>("models").resolveGuard();
  if (guard === undefined) {
    return;
  }
  const clipped =
    resultText.length > STEWARD_RESULT_MAX
      ? `${resultText.slice(0, STEWARD_RESULT_MAX)}…`
      : resultText;
  try {
    const steward = await guard.steward(
      {
        tool,
        args,
        resultText: clipped,
        workspaceRoot,
        channel,
      },
      signal,
    );
    appendEvent(session, onEvent, {
      type: "guard/steward",
      callId,
      tool,
      verdict: steward.verdict,
      summary: steward.summary,
    });
  } catch {
    // steward failure does not block the turn
  }
}

function resolveConversationProvider(models: ModelRegistry): {
  provider: import("@flintloom/models").ChatProvider;
  kind: "chat" | "omni";
} {
  const omniConfigured = models.snapshot().some((row) => row.kind === "omni" && row.configured);
  if (omniConfigured) {
    return { provider: models.resolveOmni(), kind: "omni" };
  }
  return { provider: models.resolveChat(), kind: "chat" };
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

  const toolStartedAt = Date.now();
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
    if (isGuardAskError(err) && (channel === "host" || channel === "acp")) {
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
  const durationMs = Math.max(0, Date.now() - toolStartedAt);

  if (!resultText.startsWith("guard denied:")) {
    await maybeAppendGuardSteward(
      input.ctx,
      session,
      onEvent,
      call.id,
      call.name,
      call.args,
      resultText,
      workspaceRoot,
      channel,
      signal,
    );
  }

  appendEvent(session, onEvent, {
    type: "tool/result",
    callId: call.id,
    name: call.name,
    text: resultText,
    durationMs,
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
    emitTurnStats(session, onEvent, turnId, input.startedAt);
    appendEvent(session, onEvent, { type: "turn/end", turnId, status });
    await maybeDeliver(input.ctx, channel, session, turnId, signal);
    return { turnId, status };
  };

  for (let step = 0; step < MAX_STEPS; step++) {
    if (signal.aborted) {
      return await finish("cancelled");
    }

    appendEvent(session, onEvent, { type: "step/start", turnId, step: step + 1 });
    const stepNumber = step + 1;
    const stepStartedAt = Date.now();
    let firstTokenAt: number | undefined;
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;

    const emitStepStats = (): void => {
      const endedAt = Date.now();
      const stats: Extract<SessionEvent, { type: "step/stats" }> = {
        type: "step/stats",
        turnId,
        step: stepNumber,
        llmMs: Math.max(0, endedAt - stepStartedAt),
        inputTokens,
        outputTokens,
        cacheReadTokens,
      };
      if (firstTokenAt !== undefined) {
        stats.ttftMs = Math.max(0, firstTokenAt - stepStartedAt);
        stats.decodeMs = Math.max(0, endedAt - firstTokenAt);
      }
      appendEvent(session, onEvent, stats);
    };

    const markFirstToken = (): void => {
      if (firstTokenAt === undefined) {
        firstTokenAt = Date.now();
      }
    };

    let chatProvider;
    let modelKind: "chat" | "omni" = "chat";
    try {
      const resolved = resolveConversationProvider(models);
      chatProvider = resolved.provider;
      modelKind = resolved.kind;
    } catch (err) {
      if (signal.aborted) {
        emitStepStats();
        return await finish("cancelled");
      }
      emitStepStats();
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
      for await (const chunk of chatProvider.stream(
        { messages, tools: tools.schemas() },
        signal,
      )) {
        if (signal.aborted) {
          emitStepStats();
          return await finish("cancelled");
        }

        switch (chunk.type) {
          case "text":
            markFirstToken();
            accumulatedText += chunk.text;
            appendEvent(session, onEvent, {
              type: "assistant/chunk",
              text: chunk.text,
            });
            break;
          case "reasoning":
            markFirstToken();
            appendEvent(session, onEvent, {
              type: "assistant/reasoning-chunk",
              text: chunk.text,
            });
            break;
          case "tool_call":
            markFirstToken();
            toolCalls.push(chunk);
            break;
          case "usage":
            inputTokens += chunk.inputTokens;
            outputTokens += chunk.outputTokens;
            cacheReadTokens += chunk.cacheReadTokens;
            break;
          case "error":
            emitStepStats();
            appendEvent(session, onEvent, {
              type: "model/error",
              kind: modelKind,
              message: chunk.message,
            });
            return await finish("failed");
        }
      }
    } catch (err) {
      if (signal.aborted) {
        emitStepStats();
        return await finish("cancelled");
      }
      emitStepStats();
      return await failChat(session, onEvent, finish, err);
    }

    if (signal.aborted) {
      emitStepStats();
      return await finish("cancelled");
    }

    emitStepStats();

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
    images,
    onEvent,
  } = input;

  const turnId = crypto.randomUUID();
  const startedAt = Date.now();
  appendEvent(session, onEvent, { type: "turn/start", turnId, startedAt });
  if (images !== undefined && images.length > 0) {
    appendEvent(session, onEvent, { type: "user/message", text, images });
  } else {
    appendEvent(session, onEvent, { type: "user/message", text });
  }

  return runStepIterations({ ...input, turnId, startedAt });
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

  const startedAt = turnStartedAt(session, turnId);

  appendEvent(session, onEvent, {
    type: "guard/response",
    turnId,
    callId,
    decision,
  });

  let resultText: string;
  const toolStartedAt = Date.now();
  if (decision === "deny") {
    resultText = `guard denied: ${call.name}`;
  } else {
    resultText = await tools.execute(call.name, parseToolArgs(call.args), {
      workspaceRoot: input.workspaceRoot,
      signal: input.signal,
      channel: input.channel,
      guardBypass: true,
    });
    await maybeAppendGuardSteward(
      input.ctx,
      session,
      onEvent,
      callId,
      call.name,
      call.args,
      resultText,
      input.workspaceRoot,
      input.channel,
      input.signal,
    );
  }

  appendEvent(session, onEvent, {
    type: "tool/result",
    callId,
    name: call.name,
    text: resultText,
    durationMs: Math.max(0, Date.now() - toolStartedAt),
  });

  const stepWait = { value: false };
  for (const remaining of ask.remainingCalls) {
    const paused = await executeToolCall(
      { ...input, turnId, startedAt },
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
        emitTurnStats(session, onEvent, turnId, startedAt);
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

  return runStepIterations({ ...input, turnId, startedAt });
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

  return runStepIterations({
    ...input,
    turnId,
    startedAt: turnStartedAt(session, turnId),
  });
}
