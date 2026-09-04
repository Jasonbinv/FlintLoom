import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchCredentialSettings,
  installPlugin,
  putCredentialSlot,
  reloadHostSettings,
  type CredentialSlotSnapshot,
} from "./api.ts";
import { pickWorkspaceFolder } from "./workspacePicker.ts";

const CHANNEL_SLOT_IDS = new Set(["telegram", "discord", "slack", "feishu", "wecom"]);

type SlotForm = {
  apiKey: string;
  baseUrl: string;
  model: string;
  appId: string;
  agentId: string;
  callbackToken: string;
  encodingAesKey: string;
  allowedChatIds: string;
};

function emptyForm(): SlotForm {
  return {
    apiKey: "",
    baseUrl: "",
    model: "",
    appId: "",
    agentId: "",
    callbackToken: "",
    encodingAesKey: "",
    allowedChatIds: "",
  };
}

function sourceLabel(source: string): string {
  if (source === "env") return "来自 .env";
  if (source === "credentials") return "来自本机凭据";
  return "未配置";
}

function slotFormFromSnapshot(slot: CredentialSlotSnapshot): SlotForm {
  return {
    apiKey: "",
    baseUrl: slot.baseUrl ?? "",
    model: slot.model ?? "",
    appId: slot.appId ?? "",
    agentId: slot.agentId ?? "",
    callbackToken: "",
    encodingAesKey: "",
    allowedChatIds: slot.allowedChatIds ?? "",
  };
}

function channelIdsPlaceholder(slotId: string): string {
  if (slotId === "telegram") return "123456789,-1001234567890";
  if (slotId === "discord") return "123456789012345678";
  if (slotId === "slack") return "C01234567,G01234567";
  if (slotId === "wecom") return "zhangsan,lisi";
  return "oc_abc123,oc_def456";
}

function channelIdsLabel(slotId: string): string {
  if (slotId === "wecom") return "Allowed user IDs";
  if (slotId === "feishu") return "Allowed chat IDs";
  if (slotId === "telegram") return "Allowed chat IDs";
  return "Allowed channel IDs";
}

type Props = {
  onSaved?: () => void;
};

type CloseAction = "ask" | "tray" | "quit";

function hasShellPrefs(): boolean {
  return typeof window.flintloom?.getShellPrefs === "function";
}

export function SettingsPane({ onSaved }: Props) {
  const [slots, setSlots] = useState<CredentialSlotSnapshot[] | undefined>();
  const [webhook, setWebhook] = useState<{ url: string; hint: string } | undefined>();
  const [forms, setForms] = useState<Record<string, SlotForm>>({});
  const [error, setError] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const [saving, setSaving] = useState<string | undefined>();
  const [pluginPath, setPluginPath] = useState("");
  const [pluginId, setPluginId] = useState("");
  const [installing, setInstalling] = useState(false);
  const [closeAction, setCloseAction] = useState<CloseAction>("ask");
  const [shellPrefsReady, setShellPrefsReady] = useState(false);
  const [savingCloseAction, setSavingCloseAction] = useState(false);
  const closeActionSaveGeneration = useRef(0);

  const load = useCallback(() => {
    const ac = new AbortController();
    void fetchCredentialSettings(ac.signal)
      .then((data) => {
        if (!ac.signal.aborted) {
          setSlots(data.slots);
          setWebhook(data.webhook);
          const next: Record<string, SlotForm> = {};
          for (const slot of data.slots) {
            next[slot.id] = slotFormFromSnapshot(slot);
          }
          setForms(next);
          setError(false);
        }
      })
      .catch(() => {
        if (!ac.signal.aborted) setError(true);
      });
    return () => ac.abort();
  }, []);

  useEffect(() => {
    return load();
  }, [load]);

  useEffect(() => {
    if (!hasShellPrefs()) return;
    let cancelled = false;
    void window.flintloom!.getShellPrefs().then(
      (prefs) => {
        if (cancelled) return;
        if (
          prefs.closeAction === "ask" ||
          prefs.closeAction === "tray" ||
          prefs.closeAction === "quit"
        ) {
          setCloseAction(prefs.closeAction);
          setShellPrefsReady(true);
        }
      },
      () => {
        /* 读失败则不显示区块 */
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  async function onCloseActionChange(next: CloseAction) {
    const generation = ++closeActionSaveGeneration.current;
    const prev = closeAction;
    setCloseAction(next);
    setSavingCloseAction(true);
    setMessage(undefined);
    try {
      await window.flintloom!.setShellPrefs({ closeAction: next });
    } catch {
      if (closeActionSaveGeneration.current === generation) {
        setCloseAction(prev);
        setMessage("保存失败");
      }
    } finally {
      if (closeActionSaveGeneration.current === generation) {
        setSavingCloseAction(false);
      }
    }
  }

  function installErrorMessage(err: unknown): string {
    if (!(err instanceof Error)) return "安装失败";
    if (err.message === "busy") return "有对话进行中，请稍后再安装";
    if (err.message === "path") return "无效插件路径（需为含入口的本地目录）";
    if (err.message === "id") return "插件 ID 无效或已存在";
    if (err.message === "plugins") return "当前工作区缺少 flintloom.yml";
    return "安装失败";
  }

  async function installLocalPlugin() {
    const sourcePath = pluginPath.trim();
    if (sourcePath.length === 0) return;
    setInstalling(true);
    setMessage(undefined);
    try {
      const result = await installPlugin(
        sourcePath,
        pluginId.trim().length > 0 ? pluginId.trim() : undefined,
      );
      setPluginPath("");
      setPluginId("");
      onSaved?.();
      setMessage(`已安装插件 ${result.id} 并重载 host`);
    } catch (err) {
      setMessage(installErrorMessage(err));
    } finally {
      setInstalling(false);
    }
  }

  async function saveSlot(slotId: string) {
    const form = forms[slotId] ?? emptyForm();
    const body: Record<string, string> = {};
    if (form.apiKey.trim().length > 0) {
      body.apiKey = form.apiKey.trim();
    }
    if (form.baseUrl.trim().length > 0) {
      body.baseUrl = form.baseUrl.trim();
    }
    if (slotId === "chat" || slotId === "guard") {
      if (form.model.trim().length > 0) {
        body.model = form.model.trim();
      }
    }
    if (CHANNEL_SLOT_IDS.has(slotId) && form.allowedChatIds.trim().length > 0) {
      body.allowedChatIds = form.allowedChatIds.trim();
    }
    if (slotId === "feishu" && form.appId.trim().length > 0) {
      body.appId = form.appId.trim();
    }
    if (slotId === "wecom") {
      if (form.appId.trim().length > 0) {
        body.appId = form.appId.trim();
      }
      if (form.agentId.trim().length > 0) {
        body.agentId = form.agentId.trim();
      }
      if (form.callbackToken.trim().length > 0) {
        body.callbackToken = form.callbackToken.trim();
      }
      if (form.encodingAesKey.trim().length > 0) {
        body.encodingAesKey = form.encodingAesKey.trim();
      }
    }
    setSaving(slotId);
    setMessage(undefined);
    try {
      await putCredentialSlot(slotId, body);
      await reloadHostSettings();
      onSaved?.();
      setMessage("已重载");
      load();
    } catch (err) {
      if (err instanceof Error && err.message === "busy") {
        setMessage("有对话进行中，请稍后再保存");
      } else {
        setMessage("保存失败");
      }
    } finally {
      setSaving(undefined);
    }
  }

  async function clearKey(slotId: string) {
    setSaving(slotId);
    setMessage(undefined);
    try {
      await putCredentialSlot(slotId, { apiKey: "" });
      await reloadHostSettings();
      onSaved?.();
      setMessage("已清除密钥并重载");
      load();
    } catch (err) {
      if (err instanceof Error && err.message === "busy") {
        setMessage("有对话进行中，请稍后再保存");
      } else {
        setMessage("清除失败");
      }
    } finally {
      setSaving(undefined);
    }
  }

  if (error) {
    return <p className="settings-empty">host unreachable</p>;
  }
  if (slots === undefined) {
    return <p className="settings-empty">加载中…</p>;
  }

  const providerSlots = slots.filter((s) => !CHANNEL_SLOT_IDS.has(s.id));
  const channelSlots = slots.filter((s) => CHANNEL_SLOT_IDS.has(s.id));

  return (
    <div className="settings-pane-inner">
      <p className="settings-hint">
        写入 <code>~/.flintloom/credentials</code>；若在工作区 <code>.env</code> 已配置，以{" "}
        <code>.env</code> 为准。保存后会重载 host runtime。
      </p>
      {message ? <p className="settings-message">{message}</p> : null}
      {shellPrefsReady ? (
        <section className="settings-section">
          <h3 className="settings-section-title">窗口</h3>
          <div className="settings-card">
            <div className="settings-form-row">
              <label>
                关闭窗口时
                <select
                  aria-label="关闭窗口时"
                  value={closeAction}
                  disabled={savingCloseAction}
                  onChange={(e) => {
                    const next = e.target.value;
                    if (next === "ask" || next === "tray" || next === "quit") {
                      void onCloseActionChange(next);
                    }
                  }}
                >
                  <option value="ask">每次询问</option>
                  <option value="tray">最小化到托盘</option>
                  <option value="quit">退出</option>
                </select>
              </label>
            </div>
          </div>
        </section>
      ) : null}
      <section className="settings-section">
        <h3 className="settings-section-title">Providers</h3>
        {providerSlots.map((slot) => {
          const form = forms[slot.id] ?? emptyForm();
          return (
            <div key={slot.id} className="settings-card">
              <div className="settings-card-head">
                <h4>{slot.label}</h4>
                <span className={`settings-source-pill ${slot.source}`}>
                  {sourceLabel(slot.source)}
                </span>
                {slot.maskedKey ? (
                  <span className="settings-masked-key">{slot.maskedKey}</span>
                ) : null}
              </div>
              {slot.id === "guard" ? (
                <p className="settings-card-hint">
                  本地 chat 时 steward 不会随 chat 自动配置；可与 chat 共用同一 llama-server（
                  <code>http://127.0.0.1:8080/v1</code>，<code>apiKey=local</code>，model 与{" "}
                  <code>/v1/models</code> 一致）。
                </p>
              ) : null}
              <div className="settings-form-row">
                <label>
                  API Key
                  <input
                    type="password"
                    value={form.apiKey}
                    placeholder={slot.maskedKey ?? "留空则不修改"}
                    onChange={(e) =>
                      setForms((prev) => ({
                        ...prev,
                        [slot.id]: { ...form, apiKey: e.target.value },
                      }))
                    }
                  />
                </label>
              </div>
              <div className="settings-form-row">
                <label>
                  Base URL
                  <input
                    type="text"
                    value={form.baseUrl}
                    onChange={(e) =>
                      setForms((prev) => ({
                        ...prev,
                        [slot.id]: { ...form, baseUrl: e.target.value },
                      }))
                    }
                  />
                </label>
              </div>
              {slot.id === "chat" || slot.id === "guard" ? (
                <div className="settings-form-row">
                  <label>
                    Model
                    <input
                      type="text"
                      value={form.model}
                      onChange={(e) =>
                        setForms((prev) => ({
                          ...prev,
                          [slot.id]: { ...form, model: e.target.value },
                        }))
                      }
                    />
                  </label>
                </div>
              ) : null}
              <div className="settings-card-actions">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={saving === slot.id}
                  onClick={() => void saveSlot(slot.id)}
                >
                  保存
                </button>
                {slot.maskedKey ? (
                  <button
                    type="button"
                    className="btn-ghost settings-clear-key"
                    disabled={saving === slot.id}
                    onClick={() => void clearKey(slot.id)}
                  >
                    清除密钥
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </section>
      <section className="settings-section">
        <h3 className="settings-section-title">Channels</h3>
        {channelSlots.map((slot) => {
          const form = forms[slot.id] ?? emptyForm();
          const tokenLabel =
            slot.id === "feishu"
              ? "App Secret"
              : slot.id === "wecom"
                ? "Corp Secret"
                : "Bot Token";
          return (
            <div key={slot.id} className="settings-card">
              <div className="settings-card-head">
                <h4>{slot.label}</h4>
                <span className={`settings-source-pill ${slot.source}`}>
                  {sourceLabel(slot.source)}
                </span>
                {slot.maskedKey ? (
                  <span className="settings-masked-key">{slot.maskedKey}</span>
                ) : null}
              </div>
              {slot.id === "wecom" && slot.callbackUrl ? (
                <p className="settings-card-hint">
                  回调 URL：<code>{slot.callbackUrl}</code>（需公网 HTTPS，可用 ngrok 转发）
                </p>
              ) : null}
              {slot.id === "feishu" || slot.id === "wecom" ? (
                <div className="settings-form-row">
                  <label>
                    {slot.id === "wecom" ? "Corp ID" : "App ID"}
                    <input
                      type="text"
                      value={form.appId}
                      placeholder={slot.appId ?? "留空则不修改"}
                      onChange={(e) =>
                        setForms((prev) => ({
                          ...prev,
                          [slot.id]: { ...form, appId: e.target.value },
                        }))
                      }
                    />
                  </label>
                </div>
              ) : null}
              {slot.id === "wecom" ? (
                <div className="settings-form-row">
                  <label>
                    Agent ID
                    <input
                      type="text"
                      value={form.agentId}
                      placeholder={slot.agentId ?? "留空则不修改"}
                      onChange={(e) =>
                        setForms((prev) => ({
                          ...prev,
                          [slot.id]: { ...form, agentId: e.target.value },
                        }))
                      }
                    />
                  </label>
                </div>
              ) : null}
              <div className="settings-form-row">
                <label>
                  {tokenLabel}
                  <input
                    type="password"
                    value={form.apiKey}
                    placeholder={slot.maskedKey ?? "留空则不修改"}
                    onChange={(e) =>
                      setForms((prev) => ({
                        ...prev,
                        [slot.id]: { ...form, apiKey: e.target.value },
                      }))
                    }
                  />
                </label>
              </div>
              {slot.id === "wecom" ? (
                <>
                  <div className="settings-form-row">
                    <label>
                      Callback Token
                      <input
                        type="password"
                        value={form.callbackToken}
                        placeholder={slot.callbackToken ?? "留空则不修改"}
                        onChange={(e) =>
                          setForms((prev) => ({
                            ...prev,
                            [slot.id]: { ...form, callbackToken: e.target.value },
                          }))
                        }
                      />
                    </label>
                  </div>
                  <div className="settings-form-row">
                    <label>
                      Encoding AES Key（可选，明文模式可留空）
                      <input
                        type="password"
                        value={form.encodingAesKey}
                        placeholder={slot.encodingAesKey ?? "留空则不修改"}
                        onChange={(e) =>
                          setForms((prev) => ({
                            ...prev,
                            [slot.id]: { ...form, encodingAesKey: e.target.value },
                          }))
                        }
                      />
                    </label>
                  </div>
                </>
              ) : null}
              <div className="settings-form-row">
                <label>
                  {channelIdsLabel(slot.id)}
                  <input
                    type="text"
                    value={form.allowedChatIds}
                    placeholder={channelIdsPlaceholder(slot.id)}
                    onChange={(e) =>
                      setForms((prev) => ({
                        ...prev,
                        [slot.id]: { ...form, allowedChatIds: e.target.value },
                      }))
                    }
                  />
                </label>
              </div>
              <div className="settings-card-actions">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={saving === slot.id}
                  onClick={() => void saveSlot(slot.id)}
                >
                  保存
                </button>
                {slot.maskedKey ? (
                  <button
                    type="button"
                    className="btn-ghost settings-clear-key"
                    disabled={saving === slot.id}
                    onClick={() => void clearKey(slot.id)}
                  >
                    清除密钥
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
        {webhook ? (
          <div className="settings-card settings-card-readonly">
            <h4>Webhook</h4>
            <p className="settings-hint">
              <code>{webhook.url}</code>
            </p>
            <p className="settings-hint">{webhook.hint}</p>
          </div>
        ) : null}
        <div className="settings-card settings-card-readonly">
          <h4>个人微信桥接</h4>
          <p className="settings-card-hint">
            独立进程 <code>pnpm wechat-bridge</code> 将个人微信消息转发到上方 Webhook（方案 1，有封号风险）。
            默认 HTTP 入站：<code>http://127.0.0.1:7340/v1/inbound</code>。详见{" "}
            <code>docs/wechat-bridge.md</code>。
          </p>
        </div>
      </section>
      <section className="settings-section">
        <h3 className="settings-section-title">插件安装</h3>
        <div className="settings-card">
          <p className="settings-card-hint">
            等价于 <code>pnpm flint plugin add &lt;路径&gt;</code>：将本地插件目录复制到{" "}
            <code>~/.flintloom/plugins/</code>，并在当前工作区{" "}
            <code>flintloom.yml</code> 末尾追加一行。安装成功后会自动重载 host。
          </p>
          <div className="settings-form-row settings-path-row">
            <label>
              插件目录
              <input
                type="text"
                value={pluginPath}
                placeholder="G:/path/to/my-plugin"
                onChange={(e) => setPluginPath(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="btn-ghost settings-browse-btn"
              disabled={installing}
              onClick={() =>
                void pickWorkspaceFolder().then((picked) => {
                  if (picked) setPluginPath(picked);
                })
              }
            >
              浏览…
            </button>
          </div>
          <div className="settings-form-row">
            <label>
              插件 ID（可选）
              <input
                type="text"
                value={pluginId}
                placeholder="留空则使用目录名"
                onChange={(e) => setPluginId(e.target.value)}
              />
            </label>
          </div>
          <div className="settings-card-actions">
            <button
              type="button"
              className="btn-primary"
              disabled={installing || pluginPath.trim().length === 0}
              onClick={() => void installLocalPlugin()}
            >
              安装插件
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
