import type { UserImage, WorkbenchEvent } from "./types.ts";
import type { TurnStats } from "./turnStats.ts";
import {
  toolResultState,
  truncateToolResult,
} from "./toolDisplay.ts";

export type Bubble =
  | { id: string; kind: "user"; text: string; images?: UserImage[] }
  | { id: string; kind: "assistant"; text: string }
  | { id: string; kind: "reasoning"; text: string }
  | {
      id: string;
      kind: "tool-step";
      callId: string;
      name: string;
      args: unknown;
      result?: string;
      state: "running" | "done" | "error";
      step?: number;
    }
  | { id: string; kind: "turn-footer"; stats: TurnStats }
  | { id: string; kind: "error"; message: string }
  | { id: string; kind: "a2ui"; surfaceId: string; messages: unknown[]; turnId: string }
  | { id: string; kind: "guard-ask"; tool: string; callId: string; turnId: string }
  | {
      id: string;
      kind: "guard-steward";
      tool: string;
      verdict: "ok" | "suspicious";
      summary: string;
    };

function bubbleFromSingleEvent(event: WorkbenchEvent, id: string): Bubble | undefined {
  switch (event.type) {
    case "user/message":
      return {
        id,
        kind: "user",
        text: event.text,
        images: event.images,
      };
    case "assistant/message":
      return { id, kind: "assistant", text: event.text };
    case "model/error":
      return { id, kind: "error", message: event.message };
    case "a2ui/surface":
      return {
        id,
        kind: "a2ui",
        surfaceId: event.surfaceId,
        messages: event.messages,
        turnId: event.turnId,
      };
    case "guard/ask":
      return {
        id,
        kind: "guard-ask",
        tool: event.tool,
        callId: event.callId,
        turnId: event.turnId,
      };
    case "guard/steward":
      if (event.verdict === "ok" && event.summary.length === 0) {
        return undefined;
      }
      return {
        id,
        kind: "guard-steward",
        tool: event.tool,
        verdict: event.verdict,
        summary: event.summary,
      };
    default:
      return undefined;
  }
}

export function buildBubblesFromEvents(
  events: WorkbenchEvent[],
  allocId: () => string,
): Bubble[] {
  const bubbles: Bubble[] = [];
  let reasoningBuf = "";
  const toolIndex = new Map<string, number>();
  let currentStep: number | undefined;
  let pendingTurnStats: TurnStats | undefined;

  const flushReasoning = (): void => {
    if (reasoningBuf.length === 0) {
      return;
    }
    bubbles.push({ id: allocId(), kind: "reasoning", text: reasoningBuf });
    reasoningBuf = "";
  };

  const flushTurnFooter = (status?: TurnStats["status"]): void => {
    if (pendingTurnStats === undefined) {
      return;
    }
    bubbles.push({
      id: allocId(),
      kind: "turn-footer",
      stats: status ? { ...pendingTurnStats, status } : pendingTurnStats,
    });
    pendingTurnStats = undefined;
    currentStep = undefined;
  };

  for (const event of events) {
    if (event.type === "step/start") {
      currentStep = event.step;
      continue;
    }
    if (event.type === "turn/stats") {
      pendingTurnStats = {
        turnId: event.turnId,
        steps: event.steps,
        toolCalls: event.toolCalls,
        durationMs: event.durationMs,
        guard: { ...event.guard },
      };
      continue;
    }
    if (event.type === "turn/end") {
      flushTurnFooter(event.status);
      continue;
    }
    if (event.type === "turn/start" || event.type === "guard/decision" || event.type === "guard/response") {
      continue;
    }
    if (event.type === "assistant/reasoning-chunk") {
      reasoningBuf += event.text;
      continue;
    }
    if (event.type === "assistant/chunk") {
      continue;
    }
    if (event.type === "assistant/message") {
      flushReasoning();
      bubbles.push({ id: allocId(), kind: "assistant", text: event.text });
      continue;
    }
    if (event.type === "tool/call") {
      flushReasoning();
      const bubble: Bubble = {
        id: allocId(),
        kind: "tool-step",
        callId: event.callId,
        name: event.name,
        args: event.args,
        state: "running",
        ...(currentStep !== undefined ? { step: currentStep } : {}),
      };
      toolIndex.set(event.callId, bubbles.length);
      bubbles.push(bubble);
      continue;
    }
    if (event.type === "tool/result") {
      const idx = toolIndex.get(event.callId);
      const result = truncateToolResult(event.text);
      const state = toolResultState(event.text);
      if (idx !== undefined) {
        const existing = bubbles[idx];
        if (existing?.kind === "tool-step") {
          bubbles[idx] = { ...existing, result, state };
        }
      } else {
        bubbles.push({
          id: allocId(),
          kind: "tool-step",
          callId: event.callId,
          name: event.name,
          args: {},
          result,
          state,
        });
      }
      continue;
    }
    flushReasoning();
    const bubble = bubbleFromSingleEvent(event, allocId());
    if (bubble) {
      bubbles.push(bubble);
    }
  }

  return bubbles;
}

export function statsFromEvents(events: WorkbenchEvent[]): TurnStats[] {
  const stats: TurnStats[] = [];
  let pending: TurnStats | undefined;
  for (const event of events) {
    if (event.type === "turn/stats") {
      pending = {
        turnId: event.turnId,
        steps: event.steps,
        toolCalls: event.toolCalls,
        durationMs: event.durationMs,
        guard: { ...event.guard },
      };
    }
    if (event.type === "turn/end" && pending !== undefined) {
      stats.push({ ...pending, status: event.status });
      pending = undefined;
    }
  }
  return stats;
}

export function applyToolCall(bubbles: Bubble[], event: Extract<WorkbenchEvent, { type: "tool/call" }>, id: string, step?: number): Bubble[] {
  return [
    ...bubbles,
    {
      id,
      kind: "tool-step",
      callId: event.callId,
      name: event.name,
      args: event.args,
      state: "running",
      ...(step !== undefined ? { step } : {}),
    },
  ];
}

export function applyToolResult(
  bubbles: Bubble[],
  event: Extract<WorkbenchEvent, { type: "tool/result" }>,
): Bubble[] {
  const result = truncateToolResult(event.text);
  const state = toolResultState(event.text);
  let matched = false;
  const next = bubbles.map((bubble) => {
    if (bubble.kind === "tool-step" && bubble.callId === event.callId) {
      matched = true;
      return { ...bubble, result, state };
    }
    return bubble;
  });
  if (matched) {
    return next;
  }
  return [
    ...next,
    {
      id: crypto.randomUUID(),
      kind: "tool-step",
      callId: event.callId,
      name: event.name,
      args: {},
      result,
      state,
    },
  ];
}

export function bubbleFromHistory(event: WorkbenchEvent, id: string): Bubble | undefined {
  if (event.type === "tool/call") {
    return {
      id,
      kind: "tool-step",
      callId: event.callId,
      name: event.name,
      args: event.args,
      state: "running",
    };
  }
  if (event.type === "tool/result") {
    return {
      id,
      kind: "tool-step",
      callId: event.callId,
      name: event.name,
      args: {},
      result: truncateToolResult(event.text),
      state: toolResultState(event.text),
    };
  }
  return bubbleFromSingleEvent(event, id);
}
