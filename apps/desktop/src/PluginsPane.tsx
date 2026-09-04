import { useCallback, useEffect, useState } from "react";
import {
  copyMcpServer,
  createMcpServer,
  deleteMcpServer,
  fetchMcpServers,
  fetchPlugins,
  reloadHostSettings,
  setMcpServerEnabled,
  updateMcpServer,
  type McpServerSnapshot,
} from "./api.ts";

type PluginRow = { id: string; name: string; status: "loaded" };

type Draft = {
  command: string;
  args: string;
  env: string;
};

type NewDraft = Draft & { id: string };

function emptyNewDraft(): NewDraft {
  return { id: "", command: "", args: "", env: "" };
}

function draftFrom(server: McpServerSnapshot): Draft {
  return {
    command: server.command,
    args: JSON.stringify(server.args),
    env: server.env.join(", "),
  };
}

function parseArgs(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("args");
  }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error("args");
  }
  return parsed;
}

function parseEnv(text: string): string[] {
  const trimmed = text.trim();
  return trimmed.length === 0 ? [] : trimmed.split(/[,\s]+/).filter((item) => item.length > 0);
}

function mcpWriteError(err: unknown): string {
  if (!(err instanceof Error)) return "操作失败";
  if (err.message === "busy") return "已保存，对话结束后重载";
  if (err.message === "id") return "ID 无效或已存在";
  if (err.message === "command") return "command 无效";
  if (err.message === "home") return "个人目录条目请先复制到工作区";
  if (err.message === "args") return "args 无效";
  if (err.message === "env") return "env 无效";
  return "操作失败";
}

function statusClass(status: McpServerSnapshot["status"]): string {
  if (status === "loaded") return "ok";
  if (status === "disabled") return "warn";
  return "down";
}

function statusLabel(status: McpServerSnapshot["status"]): string {
  if (status === "loaded") return "已加载";
  if (status === "disabled") return "已关闭";
  return "失败";
}

export function PluginsPane() {
  const [servers, setServers] = useState<McpServerSnapshot[] | undefined>();
  const [plugins, setPlugins] = useState<PluginRow[] | undefined>();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [error, setError] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newDraft, setNewDraft] = useState<NewDraft>(emptyNewDraft);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | undefined>();

  const load = useCallback(() => {
    const ac = new AbortController();
    void Promise.all([fetchMcpServers(ac.signal), fetchPlugins(ac.signal)])
      .then(([mcp, list]) => {
        if (ac.signal.aborted) return;
        const next = mcp.servers;
        setServers(next);
        setPlugins(list);
        const nextDrafts: Record<string, Draft> = {};
        for (const server of next) {
          if (server.writable) nextDrafts[server.id] = draftFrom(server);
        }
        setDrafts(nextDrafts);
        setError(false);
      })
      .catch(() => {
        if (!ac.signal.aborted) setError(true);
      });
    return () => ac.abort();
  }, []);

  useEffect(() => {
    return load();
  }, [load]);

  function noteBusy() {
    setMessage("已保存，对话结束后重载");
  }

  async function runWrite(action: () => Promise<void>) {
    setSaving(true);
    setMessage(undefined);
    try {
      await action();
      load();
    } catch (err) {
      if (err instanceof Error && err.message === "busy") {
        noteBusy();
        load();
      } else {
        setMessage(mcpWriteError(err));
      }
    } finally {
      setSaving(false);
    }
  }

  async function onReload() {
    setSaving(true);
    setMessage(undefined);
    try {
      await reloadHostSettings();
      setMessage("已重载");
      load();
    } catch (err) {
      if (err instanceof Error && err.message === "busy") {
        noteBusy();
      } else {
        setMessage("重载失败");
      }
    } finally {
      setSaving(false);
    }
  }

  async function onToggle(server: McpServerSnapshot, enabled: boolean) {
    setSaving(true);
    setMessage(undefined);
    try {
      const result = await setMcpServerEnabled(server.id, enabled);
      if (result.busy) noteBusy();
      load();
    } catch (err) {
      if (err instanceof Error && err.message === "busy") {
        noteBusy();
        load();
      } else {
        setMessage(mcpWriteError(err));
      }
    } finally {
      setSaving(false);
    }
  }

  async function onSave(id: string) {
    const draft = drafts[id];
    if (draft === undefined) return;
    let args: string[];
    try {
      args = parseArgs(draft.args);
    } catch (err) {
      setMessage(mcpWriteError(err));
      return;
    }
    await runWrite(() =>
      updateMcpServer(id, {
        command: draft.command,
        args,
        env: parseEnv(draft.env),
      }),
    );
  }

  async function onCreate() {
    const id = newDraft.id.trim();
    const command = newDraft.command.trim();
    if (id.length === 0 || command.length === 0) return;
    let args: string[];
    try {
      args = parseArgs(newDraft.args);
    } catch (err) {
      setMessage(mcpWriteError(err));
      return;
    }
    await runWrite(async () => {
      await createMcpServer({
        id,
        command,
        args,
        env: parseEnv(newDraft.env),
      });
      setAdding(false);
      setNewDraft(emptyNewDraft());
    });
  }

  async function onDelete(id: string) {
    await runWrite(async () => {
      await deleteMcpServer(id);
      setConfirmDeleteId(undefined);
    });
  }

  async function onCopy(id: string) {
    await runWrite(() => copyMcpServer(id));
  }

  if (error) {
    return (
      <div className="settings-pane-inner">
        <div className="settings-card-actions">
          <button type="button" className="btn-ghost" disabled={saving} onClick={() => void onReload()}>
            重载 host
          </button>
        </div>
        {message ? <p className="settings-message">{message}</p> : null}
        <p className="settings-empty">host unreachable</p>
      </div>
    );
  }
  if (servers === undefined || plugins === undefined) {
    return <p className="settings-empty">加载中…</p>;
  }

  const coreRows = plugins.filter((row) => row.name !== "@flintloom/mcp");

  return (
    <div className="settings-pane-inner">
      <div className="settings-card-actions">
        <button type="button" className="btn-ghost" disabled={saving} onClick={() => void onReload()}>
          重载 host
        </button>
      </div>
      {message ? <p className="settings-message">{message}</p> : null}

      <section className="settings-section">
        <h3 className="settings-section-title">MCP 服务器</h3>
        {servers.length === 0 && !adding ? (
          <p className="settings-hint">还没有 MCP 服务器。</p>
        ) : null}
        {servers.map((server) => {
          const draft = drafts[server.id] ?? draftFrom(server);
          return (
            <div
              key={server.id}
              className={
                server.writable ? "settings-card" : "settings-card settings-card-readonly"
              }
            >
              <div className="settings-card-head">
                <h4>{server.id}</h4>
                {server.source === "home" && !server.writable ? (
                  <span className="settings-source-pill">个人</span>
                ) : null}
                <span className={`status-pill compact ${statusClass(server.status)}`}>
                  {statusLabel(server.status)}
                </span>
                {server.writable ? (
                  <label className="settings-toggle">
                    <input
                      type="checkbox"
                      checked={server.enabled}
                      disabled={saving}
                      onChange={(event) => void onToggle(server, event.target.checked)}
                    />
                    启用
                  </label>
                ) : null}
              </div>
              {server.error ? (
                <p className="settings-card-hint">{server.error}</p>
              ) : null}
              {server.writable ? (
                <>
                  <div className="settings-form-row">
                    <label>
                      command
                      <input
                        type="text"
                        value={draft.command}
                        disabled={saving}
                        onChange={(event) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [server.id]: { ...draft, command: event.target.value },
                          }))
                        }
                      />
                    </label>
                  </div>
                  <div className="settings-form-row">
                    <label>
                      args
                      <input
                        type="text"
                        value={draft.args}
                        disabled={saving}
                        onChange={(event) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [server.id]: { ...draft, args: event.target.value },
                          }))
                        }
                      />
                    </label>
                  </div>
                  <div className="settings-form-row">
                    <label>
                      env
                      <input
                        type="text"
                        value={draft.env}
                        disabled={saving}
                        onChange={(event) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [server.id]: { ...draft, env: event.target.value },
                          }))
                        }
                      />
                    </label>
                  </div>
                  <div className="settings-card-actions">
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={saving || draft.command.trim().length === 0}
                      onClick={() => void onSave(server.id)}
                    >
                      保存
                    </button>
                    {confirmDeleteId === server.id ? (
                      <>
                        <button
                          type="button"
                          className="btn-danger"
                          disabled={saving}
                          onClick={() => void onDelete(server.id)}
                        >
                          确认删除
                        </button>
                        <button
                          type="button"
                          className="btn-ghost"
                          disabled={saving}
                          onClick={() => setConfirmDeleteId(undefined)}
                        >
                          取消
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="btn-ghost"
                        disabled={saving}
                        onClick={() => setConfirmDeleteId(server.id)}
                      >
                        删除
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <p className="settings-card-hint">
                    <code>{server.command}</code>
                    {server.args.length > 0 ? ` ${JSON.stringify(server.args)}` : ""}
                  </p>
                  <div className="settings-card-actions">
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={saving}
                      onClick={() => void onCopy(server.id)}
                    >
                      复制到工作区
                    </button>
                  </div>
                </>
              )}
              <details>
                <summary>工具与详情</summary>
                {server.tools.length > 0 ? (
                  <p className="settings-card-hint">{server.tools.join(", ")}</p>
                ) : (
                  <p className="settings-card-hint">无已登记工具</p>
                )}
              </details>
            </div>
          );
        })}
        {adding ? (
          <div className="settings-card">
            <div className="settings-card-head">
              <h4>添加服务器</h4>
            </div>
            <div className="settings-form-row">
              <label>
                id
                <input
                  type="text"
                  value={newDraft.id}
                  disabled={saving}
                  onChange={(event) => setNewDraft((prev) => ({ ...prev, id: event.target.value }))}
                />
              </label>
            </div>
            <div className="settings-form-row">
              <label>
                command
                <input
                  type="text"
                  value={newDraft.command}
                  disabled={saving}
                  onChange={(event) =>
                    setNewDraft((prev) => ({ ...prev, command: event.target.value }))
                  }
                />
              </label>
            </div>
            <div className="settings-form-row">
              <label>
                args
                <input
                  type="text"
                  value={newDraft.args}
                  disabled={saving}
                  onChange={(event) =>
                    setNewDraft((prev) => ({ ...prev, args: event.target.value }))
                  }
                />
              </label>
            </div>
            <div className="settings-form-row">
              <label>
                env
                <input
                  type="text"
                  value={newDraft.env}
                  disabled={saving}
                  onChange={(event) =>
                    setNewDraft((prev) => ({ ...prev, env: event.target.value }))
                  }
                />
              </label>
            </div>
            <div className="settings-card-actions">
              <button
                type="button"
                className="btn-primary"
                disabled={
                  saving || newDraft.id.trim().length === 0 || newDraft.command.trim().length === 0
                }
                onClick={() => void onCreate()}
              >
                保存
              </button>
              <button
                type="button"
                className="btn-ghost"
                disabled={saving}
                onClick={() => {
                  setAdding(false);
                  setNewDraft(emptyNewDraft());
                }}
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <div className="settings-card-actions">
            <button
              type="button"
              className="btn-primary"
              disabled={saving}
              onClick={() => setAdding(true)}
            >
              添加服务器
            </button>
          </div>
        )}
      </section>

      <section className="settings-section">
        <details>
          <summary className="settings-section-title">内核插件</summary>
          {coreRows.length === 0 ? (
            <p className="settings-hint">无已加载内核插件</p>
          ) : (
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
                  {coreRows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.id}</td>
                      <td className="mono">{row.name}</td>
                      <td>{row.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </details>
      </section>

      <p className="settings-hint">
        工作区 <code>mcp-servers.yml</code> 管理 stdio MCP；其它插件见{" "}
        <code>flintloom.yml</code>。
      </p>
    </div>
  );
}
