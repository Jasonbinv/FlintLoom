export type TurnGuardStats = {
  allow: number;
  deny: number;
  ask: number;
  suspicious: number;
};

export type TurnStats = {
  turnId: string;
  steps: number;
  toolCalls: number;
  durationMs: number;
  llmMs: number;
  toolMs: number;
  ttftMs: number;
  ttftSteps: number;
  decodeMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  guard: TurnGuardStats;
  status?: "ok" | "failed" | "cancelled";
};

export function turnStatsFromEvent(event: {
  turnId: string;
  steps: number;
  toolCalls: number;
  durationMs: number;
  llmMs?: number;
  toolMs?: number;
  ttftMs?: number;
  ttftSteps?: number;
  decodeMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  guard: TurnGuardStats;
}): Omit<TurnStats, "status"> {
  return {
    turnId: event.turnId,
    steps: event.steps,
    toolCalls: event.toolCalls,
    durationMs: event.durationMs,
    llmMs: event.llmMs ?? 0,
    toolMs: event.toolMs ?? 0,
    ttftMs: event.ttftMs ?? 0,
    ttftSteps: event.ttftSteps ?? 0,
    decodeMs: event.decodeMs ?? 0,
    inputTokens: event.inputTokens ?? 0,
    outputTokens: event.outputTokens ?? 0,
    cacheReadTokens: event.cacheReadTokens ?? 0,
    guard: { ...event.guard },
  };
}

export function formatDuration(ms: number): string {
  const s = ms / 1000;
  if (s < 60) {
    return `${Math.round(s * 10) / 10}s`;
  }
  const whole = Math.round(s);
  return `${Math.floor(whole / 60)}m${whole % 60}s`;
}

export function formatTokens(n: number): string {
  const scaled = (v: number): string =>
    v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${scaled(n / 1_000)}K`;
  return `${scaled(n / 1_000_000)}M`;
}

export function formatTokensPerSecond(tps: number): string {
  const clamped = Math.max(0, tps);
  return clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10);
}

export function cacheHitPercent(cacheReadTokens: number, inputTokens: number): string | undefined {
  if (inputTokens <= 0 || cacheReadTokens <= 0) {
    return undefined;
  }
  const pct = Math.min(100, Math.round((cacheReadTokens / inputTokens) * 100));
  return String(pct);
}

export function formatGuardSummary(guard: TurnGuardStats): string | undefined {
  const parts: string[] = [];
  if (guard.allow > 0) parts.push(`allow ${guard.allow}`);
  if (guard.deny > 0) parts.push(`deny ${guard.deny}`);
  if (guard.ask > 0) parts.push(`ask ${guard.ask}`);
  if (guard.suspicious > 0) parts.push(`suspicious ${guard.suspicious}`);
  if (parts.length === 0) {
    return undefined;
  }
  return `guard: ${parts.join(" · ")}`;
}

export type SessionStatsAgg = {
  turns: number;
  steps: number;
  toolCalls: number;
  durationMs: number;
  llmMs: number;
  toolMs: number;
  ttftMs: number;
  ttftSteps: number;
  decodeMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  guard: TurnGuardStats;
};

export function aggregateSessionStats(stats: TurnStats[]): SessionStatsAgg {
  const guard: TurnGuardStats = { allow: 0, deny: 0, ask: 0, suspicious: 0 };
  let steps = 0;
  let toolCalls = 0;
  let durationMs = 0;
  let llmMs = 0;
  let toolMs = 0;
  let ttftMs = 0;
  let ttftSteps = 0;
  let decodeMs = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  for (const row of stats) {
    steps += row.steps;
    toolCalls += row.toolCalls;
    durationMs += row.durationMs;
    llmMs += row.llmMs;
    toolMs += row.toolMs;
    ttftMs += row.ttftMs;
    ttftSteps += row.ttftSteps;
    decodeMs += row.decodeMs;
    inputTokens += row.inputTokens;
    outputTokens += row.outputTokens;
    cacheReadTokens += row.cacheReadTokens;
    guard.allow += row.guard.allow;
    guard.deny += row.guard.deny;
    guard.ask += row.guard.ask;
    guard.suspicious += row.guard.suspicious;
  }
  return {
    turns: stats.length,
    steps,
    toolCalls,
    durationMs,
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

export function tokensPerSecond(outputTokens: number, decodeMs: number): number | undefined {
  if (outputTokens <= 0 || decodeMs <= 0) {
    return undefined;
  }
  return outputTokens / (decodeMs / 1000);
}
