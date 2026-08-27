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
  guard: TurnGuardStats;
  status?: "ok" | "failed" | "cancelled";
};

export function formatDuration(ms: number): string {
  const s = ms / 1000;
  if (s < 60) {
    return `${Math.round(s * 10) / 10}s`;
  }
  const whole = Math.round(s);
  return `${Math.floor(whole / 60)}m${whole % 60}s`;
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

export function aggregateSessionStats(stats: TurnStats[]): {
  turns: number;
  steps: number;
  toolCalls: number;
  durationMs: number;
  guard: TurnGuardStats;
} {
  const guard: TurnGuardStats = { allow: 0, deny: 0, ask: 0, suspicious: 0 };
  let steps = 0;
  let toolCalls = 0;
  let durationMs = 0;
  for (const row of stats) {
    steps += row.steps;
    toolCalls += row.toolCalls;
    durationMs += row.durationMs;
    guard.allow += row.guard.allow;
    guard.deny += row.guard.deny;
    guard.ask += row.guard.ask;
    guard.suspicious += row.guard.suspicious;
  }
  return { turns: stats.length, steps, toolCalls, durationMs, guard };
}
