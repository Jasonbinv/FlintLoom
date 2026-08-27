import { formatDuration, formatGuardSummary, type TurnStats } from "./turnStats.ts";

type Props = {
  stats: TurnStats;
};

export function TurnFooter({ stats }: Props) {
  const guardSummary = formatGuardSummary(stats.guard);
  const parts: string[] = [];

  if (stats.steps > 0) {
    parts.push(`${stats.steps} step${stats.steps === 1 ? "" : "s"}`);
  }
  if (stats.toolCalls > 0) {
    parts.push(`${stats.toolCalls} tool${stats.toolCalls === 1 ? "" : "s"}`);
  }
  if (stats.durationMs > 0) {
    parts.push(formatDuration(stats.durationMs));
  }
  if (guardSummary) {
    parts.push(guardSummary);
  }
  if (stats.status === "failed") {
    parts.push("failed");
  } else if (stats.status === "cancelled") {
    parts.push("cancelled");
  }

  if (parts.length === 0) {
    return null;
  }

  return (
    <div className="turn-footer" aria-label="Turn statistics">
      {parts.map((part, index) => (
        <span key={part} className="turn-footer-part">
          {index > 0 ? <span className="turn-footer-sep" aria-hidden>·</span> : null}
          {part}
        </span>
      ))}
    </div>
  );
}
