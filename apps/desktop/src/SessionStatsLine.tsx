import {
  aggregateSessionStats,
  cacheHitPercent,
  formatDuration,
  formatGuardSummary,
  formatTokens,
  formatTokensPerSecond,
  tokensPerSecond,
  type TurnStats,
} from "./turnStats.ts";

type Props = {
  stats: TurnStats[];
};

export function SessionStatsLine({ stats }: Props) {
  if (stats.length === 0) {
    return null;
  }

  const agg = aggregateSessionStats(stats);
  const groups: string[] = [];

  if (agg.steps > 0) {
    groups.push(`${agg.turns} turn${agg.turns === 1 ? "" : "s"} · ${agg.steps} step${agg.steps === 1 ? "" : "s"}`);
  }

  const durations: string[] = [];
  if (agg.llmMs > 0) durations.push(`LLM ${formatDuration(agg.llmMs)}`);
  if (agg.toolMs > 0) durations.push(`Tool ${formatDuration(agg.toolMs)}`);
  if (durations.length > 0) {
    groups.push(durations.join(" · "));
  } else if (agg.durationMs > 0) {
    groups.push(formatDuration(agg.durationMs));
  }

  const speeds: string[] = [];
  if (agg.ttftSteps > 0) {
    speeds.push(`TTFT avg ${formatDuration(agg.ttftMs / agg.ttftSteps)}`);
  }
  const tps = tokensPerSecond(agg.outputTokens, agg.decodeMs);
  if (tps !== undefined) {
    speeds.push(`${formatTokensPerSecond(tps)} tok/s`);
  }
  if (speeds.length > 0) {
    groups.push(speeds.join(" · "));
  }

  if (agg.inputTokens > 0 || agg.outputTokens > 0) {
    const cacheHit = cacheHitPercent(agg.cacheReadTokens, agg.inputTokens);
    if (cacheHit !== undefined) {
      groups.push(`Cache hit ${cacheHit}%`);
    }
    groups.push(`Input ${formatTokens(agg.inputTokens)} tok · Output ${formatTokens(agg.outputTokens)} tok`);
  }

  if (agg.toolCalls > 0) {
    groups.push(`${agg.toolCalls} tool${agg.toolCalls === 1 ? "" : "s"}`);
  }
  const guardSummary = formatGuardSummary(agg.guard);
  if (guardSummary) {
    groups.push(guardSummary);
  }

  if (groups.length === 0) {
    return null;
  }

  return (
    <div className="session-stats-line" aria-label="Session statistics">
      {groups.map((group, index) => (
        <span key={`${index}-${group}`} className="session-stats-group">
          {index > 0 ? <span className="session-stats-sep" aria-hidden>|</span> : null}
          {group}
        </span>
      ))}
    </div>
  );
}
