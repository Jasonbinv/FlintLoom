import { useEffect, useRef, useState } from "react";
import {
  fetchKnowledge,
  importKnowledge,
  searchKnowledge,
  type KnowledgeHit,
  type KnowledgeListItem,
} from "./knowledge.ts";

type Props = {
  selectedPath?: string;
};

type Row = {
  id: number;
  path: string;
  status?: "ok" | "failed";
  current: boolean;
  snippet?: string;
  failReason?: string;
};

function itemToRow(item: KnowledgeListItem): Row {
  return {
    id: item.id,
    path: item.path,
    status: item.status,
    current: item.current,
    failReason: item.failReason,
  };
}

function hitToRow(hit: KnowledgeHit): Row {
  return {
    id: hit.id,
    path: hit.path,
    current: hit.current,
    snippet: hit.snippet,
  };
}

export function KnowledgePane({ selectedPath }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState(false);
  const [detail, setDetail] = useState("");
  const acRef = useRef<AbortController | undefined>(undefined);

  async function loadList(signal: AbortSignal) {
    const data = await fetchKnowledge(signal);
    if (signal.aborted) return;
    setRows(data.items.map(itemToRow));
    setError(false);
  }

  async function loadSearch(q: string, signal: AbortSignal) {
    const data = await searchKnowledge(q, signal);
    if (signal.aborted) return;
    setRows(data.hits.map(hitToRow));
    setError(false);
  }

  function refresh(q: string) {
    acRef.current?.abort();
    const ac = new AbortController();
    acRef.current = ac;
    const trimmed = q.trim();
    const run = trimmed === "" ? loadList(ac.signal) : loadSearch(trimmed, ac.signal);
    void run.catch((err) => {
      if (ac.signal.aborted) return;
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(true);
    });
  }

  useEffect(() => {
    refresh("");
    return () => {
      acRef.current?.abort();
    };
  }, []);

  async function onImport() {
    if (!selectedPath) return;
    try {
      await importKnowledge(selectedPath);
      setQuery("");
      refresh("");
    } catch {
      setError(true);
    }
  }

  function selectRow(row: Row) {
    if (row.snippet) {
      setDetail(row.snippet);
    } else if (row.failReason) {
      setDetail(row.failReason);
    } else {
      setDetail("已入库");
    }
  }

  function label(row: Row): string {
    const base = row.status ? `${row.path} · ${row.status}` : row.path;
    return row.current ? base : `${base} 其它工作区`;
  }

  return (
    <div className="knowledge-pane">
      <input
        className="knowledge-search"
        type="search"
        value={query}
        placeholder="Search knowledge"
        onChange={(e) => {
          const next = e.target.value;
          setQuery(next);
          refresh(next);
        }}
      />
      <div className="knowledge-list">
        {error ? (
          <div>host unreachable</div>
        ) : (
          rows.map((row) => (
            <div key={row.id} className="knowledge-item">
              <button type="button" onClick={() => selectRow(row)}>
                {label(row)}
              </button>
            </div>
          ))
        )}
      </div>
      <pre className="knowledge-detail">{detail}</pre>
      <div className="knowledge-footer">
        <span>导入 {selectedPath ?? ""}</span>
        <button
          type="button"
          disabled={!selectedPath}
          onClick={() => void onImport()}
        >
          Import
        </button>
      </div>
    </div>
  );
}
