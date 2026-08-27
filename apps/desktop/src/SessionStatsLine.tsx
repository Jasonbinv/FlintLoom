import { aggregateSessionStats, formatDuration, formatGuardSummary, type TurnStats } from "./turnStats.ts";

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
  if (agg.durationMs > 0) {
    groups.push(formatDuration(agg.durationMs));
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
        <span key={group} className="session-stats-group">
          {index > 0 ? <span className="session-stats-sep" aria-hidden>|</span> : null}
          {group}
        </span>
      ))}
    </div>
  );
}
