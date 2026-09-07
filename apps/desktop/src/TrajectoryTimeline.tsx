import type { TrajectoryKind, TrajectoryRecord } from "./trajectoryRecords.ts";
import type { TrajectoryTimelineModel } from "./trajectoryTimeline.ts";
import { formatDuration } from "./turnStats.ts";

export type TrajectoryTimelineProps = {
  model: TrajectoryTimelineModel;
  records: readonly TrajectoryRecord[];
  onSelect: (recordId: string) => void;
};

const KIND_LABEL: Record<TrajectoryKind, string> = {
  user: "用户",
  assistant: "助手",
  tool: "工具",
  error: "错误",
  guard: "护栏",
  a2ui: "界面",
  system: "SYSTEM",
};

export function TrajectoryTimeline({ model, records, onSelect }: TrajectoryTimelineProps) {
  return (
    <div className="trajectory-timeline" role="img" aria-label="轨迹时间轴">
      {model.spans.map((span) => {
        const left = (span.startMs / model.domainMs) * 100;
        const width = (span.durationMs / model.domainMs) * 100;
        const timing = span.durationMs > 0 ? formatDuration(span.durationMs) : "瞬时";
        const kind = records.find((row) => row.id === span.recordId)?.kind;
        const role = kind ? KIND_LABEL[kind] : span.lane;
        return (
          <button
            key={span.recordId}
            type="button"
            className="trajectory-timeline-span"
            data-timeline-id={span.recordId}
            data-lane={span.lane}
            data-inferred={span.inferred ? "true" : undefined}
            aria-label={`${role} ${timing}`}
            style={{ left: `${left}%`, width: `${width}%` }}
            onClick={() => onSelect(span.recordId)}
          />
        );
      })}
    </div>
  );
}
