import type { WorkbenchEvent } from "./types.ts";
import {
  toolDisplaySummary,
  toolDisplayTitle,
  toolResultState,
} from "./toolDisplay.ts";

export type TrajectoryKind =
  | "user"
  | "assistant"
  | "tool"
  | "error"
  | "guard"
  | "a2ui";

export type TrajectoryTiming = {
  llmMs?: number;
  ttftMs?: number;
  decodeMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  durationMs?: number;
};

export type TrajectoryRecord = {
  id: string;
  kind: TrajectoryKind;
  turn: number;
  turnId?: string;
  step?: number;
  preview: string;
  running?: boolean;
  turnStart?: boolean;
  thinking?: string;
  output?: string;
  args?: unknown;
  result?: string;
  callId?: string;
  toolName?: string;
  toolState?: "running" | "done" | "error";
  errorKind?: string;
  errorMessage?: string;
  guardTool?: string;
  guardLabel?: string;
  surfaceId?: string;
  a2uiWait?: boolean;
  timing?: TrajectoryTiming;
};

export function previewLine(text: string, max = 160): string {
  const line = text.split("\n", 1)[0] ?? "";
  const trimmed = line.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}

function assistantPreview(thinking: string, output: string, running: boolean): string {
  if (output.length > 0) return previewLine(output);
  if (running && thinking.length > 0) return "思考中";
  return previewLine(thinking);
}

function toolPreview(name: string, args: unknown, result: string | undefined): string {
  const head = `${toolDisplayTitle(name)} · ${toolDisplaySummary(name, args)}`;
  if (result === undefined || result.length === 0) return head;
  return `${head} → ${previewLine(result, 80)}`;
}

export function buildTrajectoryFromEvents(events: WorkbenchEvent[]): TrajectoryRecord[] {
  const records: TrajectoryRecord[] = [];
  let turn = 0;
  let turnId: string | undefined;
  let step: number | undefined;
  let reasoningBuf = "";
  let outputBuf = "";
  let pendingTiming: TrajectoryTiming | undefined;
  let seq = 0;
  const toolAt = new Map<string, number>();
  const seenTurnStart = new Set<number>();

  const markTurnStart = (row: TrajectoryRecord): void => {
    if (!seenTurnStart.has(row.turn)) {
      row.turnStart = true;
      seenTurnStart.add(row.turn);
    }
  };

  const flushAssistant = (running: boolean): void => {
    if (reasoningBuf.length === 0 && outputBuf.length === 0 && pendingTiming === undefined) {
      return;
    }
    const id = `assistant:${turnId ?? "none"}:${step ?? 0}`;
    const existingIdx = records.findIndex((row) => row.id === id);
    const prev = existingIdx >= 0 ? records[existingIdx] : undefined;
    const thinking =
      reasoningBuf.length > 0 ? reasoningBuf : prev?.thinking;
    const output = outputBuf.length > 0 ? outputBuf : prev?.output;
    const timing =
      pendingTiming !== undefined
        ? { ...prev?.timing, ...pendingTiming }
        : prev?.timing;
    const row: TrajectoryRecord = {
      id,
      kind: "assistant",
      turn: turn === 0 ? 1 : turn,
      turnId,
      step,
      preview: assistantPreview(thinking ?? "", output ?? "", running),
      thinking,
      output,
      timing,
      running: running || undefined,
    };
    markTurnStart(row);
    if (existingIdx >= 0) {
      records[existingIdx] = { ...prev, ...row, turnStart: prev?.turnStart };
    } else {
      records.push(row);
    }
    reasoningBuf = "";
    outputBuf = "";
    pendingTiming = undefined;
  };

  for (const event of events) {
    switch (event.type) {
      case "turn/start":
        flushAssistant(false);
        turn += 1;
        turnId = event.turnId;
        step = undefined;
        break;
      case "step/start":
        flushAssistant(false);
        turnId = event.turnId;
        step = event.step;
        if (turn === 0) turn = 1;
        break;
      case "assistant/reasoning-chunk":
        reasoningBuf += event.text;
        break;
      case "assistant/chunk":
        outputBuf += event.text;
        break;
      case "assistant/message":
        outputBuf = event.text;
        flushAssistant(false);
        break;
      case "step/stats": {
        const stats: TrajectoryTiming = {
          llmMs: event.llmMs,
          ttftMs: event.ttftMs,
          decodeMs: event.decodeMs,
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          cacheReadTokens: event.cacheReadTokens,
        };
        pendingTiming = stats;
        const id = `assistant:${event.turnId}:${event.step}`;
        const existing = records.find((row) => row.id === id);
        if (existing) {
          existing.timing = { ...existing.timing, ...stats };
          pendingTiming = undefined;
        }
        break;
      }
      case "tool/call": {
        flushAssistant(false);
        const row: TrajectoryRecord = {
          id: `tool:${event.callId}`,
          kind: "tool",
          turn: turn === 0 ? 1 : turn,
          turnId,
          step,
          preview: toolPreview(event.name, event.args, undefined),
          callId: event.callId,
          toolName: event.name,
          args: event.args,
          toolState: "running",
          running: true,
        };
        markTurnStart(row);
        toolAt.set(event.callId, records.length);
        records.push(row);
        break;
      }
      case "tool/result": {
        const idx = toolAt.get(event.callId);
        const state = toolResultState(event.text);
        const timing = event.durationMs !== undefined ? { durationMs: event.durationMs } : undefined;
        if (idx !== undefined) {
          const prev = records[idx];
          if (prev?.kind === "tool") {
            records[idx] = {
              ...prev,
              result: event.text,
              toolState: state,
              running: undefined,
              preview: toolPreview(prev.toolName ?? event.name, prev.args, event.text),
              timing: { ...prev.timing, ...timing },
            };
          }
        } else {
          const row: TrajectoryRecord = {
            id: `tool:${event.callId}`,
            kind: "tool",
            turn: turn === 0 ? 1 : turn,
            turnId,
            step,
            preview: toolPreview(event.name, {}, event.text),
            callId: event.callId,
            toolName: event.name,
            args: {},
            result: event.text,
            toolState: state,
            timing,
          };
          markTurnStart(row);
          records.push(row);
        }
        break;
      }
      case "user/message": {
        flushAssistant(false);
        if (turn === 0) turn = 1;
        const row: TrajectoryRecord = {
          id: `user:${turnId ?? `u${seq++}`}`,
          kind: "user",
          turn,
          turnId,
          preview: previewLine(event.text),
          output: event.text,
        };
        markTurnStart(row);
        records.push(row);
        break;
      }
      case "model/error": {
        flushAssistant(false);
        const row: TrajectoryRecord = {
          id: `error:${seq++}`,
          kind: "error",
          turn: turn === 0 ? 1 : turn,
          turnId,
          preview: previewLine(event.message),
          errorKind: event.kind,
          errorMessage: event.message,
        };
        markTurnStart(row);
        records.push(row);
        break;
      }
      case "guard/ask": {
        flushAssistant(false);
        const row: TrajectoryRecord = {
          id: `guard:${event.callId}`,
          kind: "guard",
          turn: turn === 0 ? 1 : turn,
          turnId: event.turnId,
          preview: `ask · ${event.tool}`,
          callId: event.callId,
          guardTool: event.tool,
          guardLabel: "ask",
        };
        markTurnStart(row);
        records.push(row);
        break;
      }
      case "guard/steward": {
        if (event.verdict === "ok" && event.summary.length === 0) break;
        flushAssistant(false);
        const row: TrajectoryRecord = {
          id: `guard-steward:${event.callId}:${seq++}`,
          kind: "guard",
          turn: turn === 0 ? 1 : turn,
          turnId,
          preview: previewLine(event.summary) || event.verdict,
          callId: event.callId,
          guardTool: event.tool,
          guardLabel: event.verdict,
        };
        markTurnStart(row);
        records.push(row);
        break;
      }
      case "a2ui/surface": {
        flushAssistant(false);
        const row: TrajectoryRecord = {
          id: `a2ui:${event.surfaceId}:${seq++}`,
          kind: "a2ui",
          turn: turn === 0 ? 1 : turn,
          turnId: event.turnId,
          preview: event.wait ? `A2UI wait · ${event.surfaceId}` : `A2UI · ${event.surfaceId}`,
          surfaceId: event.surfaceId,
          a2uiWait: event.wait,
        };
        markTurnStart(row);
        records.push(row);
        break;
      }
      case "turn/end":
        flushAssistant(false);
        break;
      default:
        break;
    }
  }
  flushAssistant(true);
  return records;
}
