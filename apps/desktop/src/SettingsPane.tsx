import { useCallback, useEffect, useState } from "react";
import {
  fetchCredentialSettings,
  putCredentialSlot,
  reloadHostSettings,
  type CredentialSlotSnapshot,
} from "./api.ts";

type SlotForm = {
  apiKey: string;
  baseUrl: string;
  model: string;
  allowedChatIds: string;
};

function emptyForm(): SlotForm {
  return { apiKey: "", baseUrl: "", model: "", allowedChatIds: "" };
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
    allowedChatIds: slot.allowedChatIds ?? "",
  };
}

type Props = {
  onSaved?: () => void;
};

export function SettingsPane({ onSaved }: Props) {
  const [slots, setSlots] = useState<CredentialSlotSnapshot[] | undefined>();
  const [webhook, setWebhook] = useState<{ url: string; hint: string } | undefined>();
  const [forms, setForms] = useState<Record<string, SlotForm>>({});
  const [error, setError] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const [saving, setSaving] = useState<string | undefined>();

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
    if (slotId === "telegram" && form.allowedChatIds.trim().length > 0) {
      body.allowedChatIds = form.allowedChatIds.trim();
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

  const providerSlots = slots.filter((s) => s.id !== "telegram");
  const telegramSlot = slots.find((s) => s.id === "telegram");

  return (
    <div className="settings-pane-inner">
      <p className="settings-hint">
        写入 <code>~/.flintloom/credentials</code>；若在工作区 <code>.env</code> 已配置，以{" "}
        <code>.env</code> 为准。保存后会重载 host runtime。
      </p>
      {message ? <p className="settings-message">{message}</p> : null}
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
        {telegramSlot ? (
          <div className="settings-card">
            <div className="settings-card-head">
              <h4>{telegramSlot.label}</h4>
              <span className={`settings-source-pill ${telegramSlot.source}`}>
                {sourceLabel(telegramSlot.source)}
              </span>
              {telegramSlot.maskedKey ? (
                <span className="settings-masked-key">{telegramSlot.maskedKey}</span>
              ) : null}
            </div>
            <div className="settings-form-row">
              <label>
                Bot Token
                <input
                  type="password"
                  value={forms.telegram?.apiKey ?? ""}
                  placeholder={telegramSlot.maskedKey ?? "留空则不修改"}
                  onChange={(e) =>
                    setForms((prev) => ({
                      ...prev,
                      telegram: {
                        ...(prev.telegram ?? emptyForm()),
                        apiKey: e.target.value,
                      },
                    }))
                  }
                />
              </label>
            </div>
            <div className="settings-form-row">
              <label>
                Allowed chat IDs
                <input
                  type="text"
                  value={forms.telegram?.allowedChatIds ?? ""}
                  placeholder="123456789,-1001234567890"
                  onChange={(e) =>
                    setForms((prev) => ({
                      ...prev,
                      telegram: {
                        ...(prev.telegram ?? emptyForm()),
                        allowedChatIds: e.target.value,
                      },
                    }))
                  }
                />
              </label>
            </div>
            <div className="settings-card-actions">
              <button
                type="button"
                className="btn-primary"
                disabled={saving === "telegram"}
                onClick={() => void saveSlot("telegram")}
              >
                保存
              </button>
              {telegramSlot.maskedKey ? (
                <button
                  type="button"
                  className="btn-ghost settings-clear-key"
                  disabled={saving === "telegram"}
                  onClick={() => void clearKey("telegram")}
                >
                  清除密钥
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        {webhook ? (
          <div className="settings-card settings-card-readonly">
            <h4>Webhook</h4>
            <p className="settings-hint">
              <code>{webhook.url}</code>
            </p>
            <p className="settings-hint">{webhook.hint}</p>
          </div>
        ) : null}
      </section>
    </div>
  );
}
