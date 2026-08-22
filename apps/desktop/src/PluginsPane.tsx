import { useEffect, useState } from "react";
import { fetchPlugins } from "./api.ts";

type PluginRow = { id: string; name: string; status: "loaded" };

export function PluginsPane() {
  const [rows, setRows] = useState<PluginRow[] | undefined>();
  const [error, setError] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    void fetchPlugins(ac.signal)
      .then((list) => {
        if (!ac.signal.aborted) {
          setRows(list);
          setError(false);
        }
      })
      .catch(() => {
        if (!ac.signal.aborted) setError(true);
      });
    return () => ac.abort();
  }, []);

  if (error) {
    return <p className="settings-empty">host unreachable</p>;
  }
  if (rows === undefined) {
    return <p className="settings-empty">加载中…</p>;
  }
  if (rows.length === 0) {
    return <p className="settings-empty">无已加载插件</p>;
  }

  return (
    <div className="settings-table-wrap">
      <table className="settings-table">
        <thead>
          <tr>
            <th>id</th>
            <th>name</th>
            <th>status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.id}</td>
              <td className="mono">{row.name}</td>
              <td>{row.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
