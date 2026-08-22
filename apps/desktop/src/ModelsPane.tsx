import { useEffect, useState } from "react";
import { fetchModels } from "./api.ts";

type ModelRow = {
  kind: string;
  defaultId: string | null;
  configured: boolean;
};

export function ModelsPane() {
  const [rows, setRows] = useState<ModelRow[] | undefined>();
  const [error, setError] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    void fetchModels(ac.signal)
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

  return (
    <div className="settings-pane-inner">
      <p className="settings-hint">
        在工作区 <code>.env</code> 或 <code>~/.flintloom/credentials</code> 配置密钥；在{" "}
        <code>flintloom.yml</code> 登记 provider 插件。本页只读，不展示密钥。
      </p>
      <div className="settings-table-wrap">
        <table className="settings-table">
          <thead>
            <tr>
              <th>kind</th>
              <th>default</th>
              <th>configured</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.kind}>
                <td>{row.kind}</td>
                <td className="mono">{row.defaultId ?? "—"}</td>
                <td>{row.configured ? "yes" : "no"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
