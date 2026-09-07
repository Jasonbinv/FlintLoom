import type { TrajectoryKind, TrajectoryRecord } from "./trajectoryRecords.ts";

export type TimelineLane = "input" | "model" | "tools";

export type TrajectoryTimelineSpan = {
  recordId: string;
  lane: TimelineLane;
  startMs: number;
  durationMs: number;
  inferred: boolean;
};

export type TrajectoryTimelineModel = {
  domainMs: number;
  spans: TrajectoryTimelineSpan[];
};

function laneOf(kind: TrajectoryKind): TimelineLane | undefined {
  if (kind === "system" || kind === "user") return "input";
  if (kind === "assistant") return "model";
  if (kind === "tool") return "tools";
  return undefined;
}

function durationOf(record: TrajectoryRecord): number {
  if (record.kind === "assistant") return record.timing?.llmMs ?? 0;
  if (record.kind === "tool") return record.timing?.durationMs ?? 0;
  return 0;
}

function isEligible(record: TrajectoryRecord): boolean {
  if (record.kind === "system" || record.kind === "user") return true;
  if (record.kind === "assistant") return record.timing?.llmMs !== undefined;
  if (record.kind === "tool") return record.timing?.durationMs !== undefined;
  return false;
}

export function deriveTrajectoryTimeline(
  records: readonly TrajectoryRecord[],
): TrajectoryTimelineModel | undefined {
  const eligible = records.filter(isEligible);
  if (eligible.length === 0) return undefined;

  const timed = eligible.filter((row) => row.startedAt !== undefined);
  const origin = timed.length > 0 ? Math.min(...timed.map((row) => row.startedAt!)) : 0;
  let maxEndAbs = origin;

  const placed = new Map<string, { startAbs: number; duration: number; inferred: boolean }>();
  for (const record of timed) {
    const duration = durationOf(record);
    const startAbs = record.startedAt!;
    placed.set(record.id, { startAbs, duration, inferred: false });
    maxEndAbs = Math.max(maxEndAbs, startAbs + duration);
  }

  let cursor = maxEndAbs;
  for (const record of eligible) {
    if (record.startedAt !== undefined) continue;
    const duration = durationOf(record);
    placed.set(record.id, { startAbs: cursor, duration, inferred: true });
    maxEndAbs = Math.max(maxEndAbs, cursor + duration);
    if (duration > 0) cursor += duration;
  }

  const spans: TrajectoryTimelineSpan[] = eligible.map((record) => {
    const spot = placed.get(record.id)!;
    const lane = laneOf(record.kind)!;
    return {
      recordId: record.id,
      lane,
      startMs: spot.startAbs - origin,
      durationMs: spot.duration,
      inferred: spot.inferred,
    };
  });

  return {
    domainMs: Math.max(1, maxEndAbs - origin),
    spans,
  };
}
