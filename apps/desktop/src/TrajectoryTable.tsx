import type { TrajectoryRecord } from "./trajectoryRecords.ts";

export type TrajectoryTableProps = {
  records: TrajectoryRecord[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

function kindLabel(kind: TrajectoryRecord["kind"]): string {
  return kind.toUpperCase();
}

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
              onClick={() => onSelect(record.id)}
            >
              <td className="trajectory-kind" data-role-kind={record.kind}>
                {kindLabel(record.kind)}
              </td>
              <td className="trajectory-event">
                {record.turnStart ? (
                  <>
                    <span className="trajectory-turn">Turn {record.turn}</span>{" "}
                  </>
                ) : null}
                {showStep ? (
                  <>
                    <span className="trajectory-step">Step {record.step}</span>{" "}
                  </>
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
