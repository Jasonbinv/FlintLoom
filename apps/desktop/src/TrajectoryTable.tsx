import type { TrajectoryRecord } from "./trajectoryRecords.ts";

export type TrajectoryTableProps = {
  records: TrajectoryRecord[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

const KIND_LABEL: Record<TrajectoryRecord["kind"], string> = {
  user: "用户",
  assistant: "助手",
  tool: "工具",
  error: "错误",
  guard: "护栏",
  a2ui: "界面",
};

export function TrajectoryTable({ records, selectedId, onSelect }: TrajectoryTableProps) {
  return (
    <table className="trajectory-table">
      <tbody>
        {records.map((record) => {
          const selected = record.id === selectedId;
          const showStep =
            (record.kind === "assistant" || record.kind === "tool") &&
            record.step !== undefined;
          return (
            <tr
              key={record.id}
              data-trajectory-id={record.id}
              aria-selected={selected}
              data-running={record.running ? "true" : undefined}
              data-turn-start={record.turnStart ? "true" : undefined}
              onClick={() => onSelect(record.id)}
            >
              <td className="trajectory-kind">
                <span className="trajectory-kind-tag" data-role-kind={record.kind}>
                  {KIND_LABEL[record.kind]}
                </span>
              </td>
              <td className="trajectory-event">
                {record.turnStart ? (
                  <span className="trajectory-meta">Turn {record.turn}</span>
                ) : null}
                {showStep ? (
                  <span className="trajectory-meta">Step {record.step}</span>
                ) : null}
                {record.running ? (
                  <span className="trajectory-running">进行中</span>
                ) : null}
                <span className="trajectory-preview">{record.preview}</span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
