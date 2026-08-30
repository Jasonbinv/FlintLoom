import { useEffect, useState } from "react";
import { TrajectoryInspector } from "./TrajectoryInspector.tsx";
import { TrajectoryTable } from "./TrajectoryTable.tsx";
import type { TrajectoryRecord } from "./trajectoryRecords.ts";

export type TrajectoryViewProps = {
  records: TrajectoryRecord[];
  inspectCallId?: string | null;
  onInspectDone?: () => void;
  onOpenFile?: (path: string) => void;
};

export function TrajectoryView({
  records,
  inspectCallId,
  onInspectDone,
  onOpenFile,
}: TrajectoryViewProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!inspectCallId) return;
    const id = `tool:${inspectCallId}`;
    if (records.some((row) => row.id === id)) {
      setSelectedId(id);
      const escapeCss =
        typeof CSS !== "undefined" && typeof CSS.escape === "function"
          ? CSS.escape.bind(CSS)
          : (value: string) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      document
        .querySelector(`[data-trajectory-id="${escapeCss(id)}"]`)
        ?.scrollIntoView?.({
          block: "nearest",
        });
    }
    onInspectDone?.();
  }, [inspectCallId, records, onInspectDone]);

  if (records.length === 0) {
    return (
      <div className="trajectory-root" data-conversation-composer-overlay="">
        <p className="trajectory-empty">尚无轨迹</p>
      </div>
    );
  }

  const selected = records.find((row) => row.id === selectedId);

  return (
    <div className="trajectory-root">
      <div className="trajectory-ledger">
        <TrajectoryTable
          records={records}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </div>
      {selected ? (
        <TrajectoryInspector
          record={selected}
          onClose={() => setSelectedId(null)}
          onOpenFile={onOpenFile}
        />
      ) : null}
    </div>
  );
}
