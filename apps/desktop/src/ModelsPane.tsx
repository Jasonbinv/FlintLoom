import { useEffect, useState } from "react";
import { fetchModels } from "./api.ts";

type ModelRow = {
  kind: string;
  defaultId: string | null;
  configured: boolean;
};

const MEDIA_KINDS = ["asr", "tts", "omni", "t2i", "t2v"] as const;

function configuredPill(kind: string, configured: boolean) {
  return (
    <span className={`status-pill compact ${configured ? "ok" : "warn"}`}>
      {kind} {configured ? "已配置" : "未配置"}
    </span>
  );
}

export function ModelsPane({ onOpenSettings }: { onOpenSettings?: () => void }) {
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
  const mediaRows = MEDIA_KINDS.map((kind) => rows.find((row) => row.kind === kind)).filter(
    (row): row is ModelRow => row !== undefined,
  );

  return (
    <div className="settings-pane-inner">
      <p className="settings-hint">
        在 <button type="button" className="linkish" onClick={onOpenSettings}>设置</button>{" "}
        配置密钥（写入 <code>~/.flintloom/credentials</code>）；也可在工作区{" "}
        <code>.env</code> 配置（优先级更高）。在 <code>flintloom.yml</code> 登记 provider 插件。本页只读，不展示密钥。
      </p>
      {guard !== undefined ? (
        <p className="models-kind-status">
          <span
            className={`status-pill ${guard.configured ? "ok" : "warn"}`}
          >
            guard {guard.configured ? "已配置" : "未配置"}
          </span>
          {guard.configured ? (
            <span className="models-kind-hint">
              工具执行后会运行 steward 分类（见聊天区可疑提示）。
            </span>
          ) : (
            <span className="models-kind-hint">
              配置 <code>FLINTLOOM_API_KEY</code> 后 host 会自动 overlay{" "}
              <code>models-guard</code>。
            </span>
          )}
        </p>
      ) : null}
      {mediaRows.length > 0 ? (
        <p className="models-kind-status">
          <span className="models-media-pills">
            {mediaRows.map((row) => (
              <span key={row.kind}>{configuredPill(row.kind, row.configured)}</span>
            ))}
          </span>
          <span className="models-kind-hint">
            媒体 kind 由 <code>models-media</code> overlay；未配置时工作台隐藏语音/朗读/图片等入口。
          </span>
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
            {rows.map((row) => {
              const isGuard = row.kind === "guard";
              const isMedia = (MEDIA_KINDS as readonly string[]).includes(row.kind);
              return (
                <tr
                  key={row.kind}
                  className={
                    isGuard
                      ? "models-row-guard"
                      : isMedia
                        ? "models-row-media"
                        : undefined
                  }
                >
                  <td>{row.kind}</td>
                  <td className="mono">{row.defaultId ?? "—"}</td>
                  <td>
                    {isGuard || isMedia ? (
                      configuredPill(row.kind, row.configured)
                    ) : (
                      row.configured ? "yes" : "no"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
