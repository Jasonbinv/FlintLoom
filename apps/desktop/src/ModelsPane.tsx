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

  const guard = rows.find((row) => row.kind === "guard");

  return (
    <div className="settings-pane-inner">
      <p className="settings-hint">
        在工作区 <code>.env</code> 或 <code>~/.flintloom/credentials</code> 配置密钥；在{" "}
        <code>flintloom.yml</code> 登记 provider 插件。本页只读，不展示密钥。
      </p>
      {guard !== undefined ? (
        <p className="models-guard-status">
          <span
            className={`status-pill ${guard.configured ? "ok" : "warn"}`}
          >
            guard {guard.configured ? "已配置" : "未配置"}
          </span>
          {guard.configured ? (
            <span className="models-guard-hint">
              工具执行后会运行 steward 分类（见聊天区可疑提示）。
            </span>
          ) : (
            <span className="models-guard-hint">
              配置 <code>FLINTLOOM_API_KEY</code> 后 host 会自动 overlay{" "}
              <code>models-guard</code>。
            </span>
          )}
        </p>
      ) : null}
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
              <tr
                key={row.kind}
                className={row.kind === "guard" ? "models-row-guard" : undefined}
              >
                <td>{row.kind}</td>
                <td className="mono">{row.defaultId ?? "—"}</td>
                <td>
                  {row.kind === "guard" ? (
                    <span
                      className={`status-pill compact ${row.configured ? "ok" : "warn"}`}
                    >
                      {row.configured ? "yes" : "no"}
                    </span>
                  ) : (
                    row.configured ? "yes" : "no"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
