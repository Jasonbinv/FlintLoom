import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { A2uiSurface } from "./A2uiSurface.tsx";
import { cancelTurn, fetchModels, fetchSession, fetchWorkspace, postTurn, postTurnAction, postTurnGuard, setWorkspace } from "./api.ts";
import { FilePane } from "./FilePane.tsx";
import { ModelsPane } from "./ModelsPane.tsx";
import { PluginsPane } from "./PluginsPane.tsx";
import { SettingsPane } from "./SettingsPane.tsx";
import { ImageInput } from "./ImageInput.tsx";
import { VoiceInput } from "./VoiceInput.tsx";
import { TtsPlay } from "./TtsPlay.tsx";
import { insertPath } from "./files.ts";
import type { UserImage, WorkbenchEvent } from "./types.ts";
import {
  applyTheme,
  loadTheme,
  nextTheme,
  saveTheme,
  THEME_ICONS,
  THEME_LABELS,
  type Theme,
} from "./theme.ts";
import {
  loadSessions,
  removeSession,
  titleFromBubbles,
  upsertSession,
  type SessionEntry,
} from "./sessionList.ts";
import { MessageFileCards } from "./MessageFileCards.tsx";
import { formatWorkspaceLabel, pickWorkspaceFolder } from "./workspacePicker.ts";
import "./app.css";

const SESSION_KEY = "flintloom.sessionId";

type Page = "chat" | "plugins" | "models" | "settings";

type Bubble =
  | { id: string; kind: "user"; text: string; images?: UserImage[] }
  | { id: string; kind: "assistant"; text: string }
  | { id: string; kind: "tool-call"; name: string; argsText: string }
  | { id: string; kind: "tool-result"; text: string }
  | { id: string; kind: "error"; message: string }
  | { id: string; kind: "a2ui"; surfaceId: string; messages: unknown[]; turnId: string }
  | { id: string; kind: "guard-ask"; tool: string; callId: string; turnId: string }
  | {
      id: string;
      kind: "guard-steward";
      tool: string;
      verdict: "ok" | "suspicious";
      summary: string;
    };

function sessionId(): string {
  let id = sessionStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

function bubbleFromHistory(event: WorkbenchEvent, id: string): Bubble | undefined {
  switch (event.type) {
    case "user/message":
      return {
        id,
        kind: "user",
        text: event.text,
        images: event.images,
      };
    case "assistant/message":
      return { id, kind: "assistant", text: event.text };
    case "tool/call":
      return {
        id,
        kind: "tool-call",
        name: event.name,
        argsText: JSON.stringify(event.args).slice(0, 200),
      };
    case "tool/result": {
      const truncated =
        event.text.length > 2000 ? `${event.text.slice(0, 2000)}…` : event.text;
      return { id, kind: "tool-result", text: truncated };
    }
    case "model/error":
      return { id, kind: "error", message: event.message };
    case "a2ui/surface":
      return {
        id,
        kind: "a2ui",
        surfaceId: event.surfaceId,
        messages: event.messages,
        turnId: event.turnId,
      };
    case "guard/ask":
      return {
        id,
        kind: "guard-ask",
        tool: event.tool,
        callId: event.callId,
        turnId: event.turnId,
      };
    case "guard/steward":
      if (event.verdict === "ok" && event.summary.length === 0) {
        return undefined;
      }
      return {
        id,
        kind: "guard-steward",
        tool: event.tool,
        verdict: event.verdict,
        summary: event.summary,
      };
    default:
      return undefined;
  }
}

function waitingTurnId(events: WorkbenchEvent[]): string | undefined {
  let turnId: string | undefined;
  let ended = false;
  let lastSurfaceWait = false;
  let actionAfterSurface = false;
  let pendingGuardAsk: { turnId: string; callId: string } | undefined;

  for (const event of events) {
    if (event.type === "turn/start") {
      turnId = event.turnId;
      ended = false;
      lastSurfaceWait = false;
      actionAfterSurface = false;
      pendingGuardAsk = undefined;
    } else if (event.type === "turn/end") {
      ended = true;
      pendingGuardAsk = undefined;
    } else if (event.type === "end") {
      if (event.status !== "awaiting_action") ended = true;
    } else if (event.type === "a2ui/surface") {
      turnId = event.turnId;
      lastSurfaceWait = event.wait;
      actionAfterSurface = false;
    } else if (event.type === "a2ui/action") {
      actionAfterSurface = true;
    } else if (event.type === "guard/ask") {
      turnId = event.turnId;
      pendingGuardAsk = { turnId: event.turnId, callId: event.callId };
    } else if (
      event.type === "guard/response" &&
      pendingGuardAsk?.callId === event.callId
    ) {
      pendingGuardAsk = undefined;
    }
  }

  if (!ended && pendingGuardAsk) return pendingGuardAsk.turnId;
  if (!ended && lastSurfaceWait && !actionAfterSurface) return turnId;
  return undefined;
}

export function App() {
  const sid = useRef(sessionId());
  const nextId = useRef(0);
  const turnIdRef = useRef<string | undefined>();
  const cancelWantedRef = useRef(false);
  const submittingActionRef = useRef(false);
  const [hostDown, setHostDown] = useState(false);
  const [chatConfigured, setChatConfigured] = useState<boolean | undefined>();
  const [guardConfigured, setGuardConfigured] = useState<boolean | undefined>();
  const [asrConfigured, setAsrConfigured] = useState(false);
  const [omniConfigured, setOmniConfigured] = useState(false);
  const [ttsConfigured, setTtsConfigured] = useState(false);
  const [pendingImages, setPendingImages] = useState<UserImage[]>([]);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [draft, setDraft] = useState("");
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [waitingAction, setWaitingAction] = useState(false);
  const [page, setPage] = useState<Page>("chat");
  const [filePaneCollapsed, setFilePaneCollapsed] = useState(false);
  const [filePaneKey, setFilePaneKey] = useState(0);
  const [previewPath, setPreviewPath] = useState<string>();
  const [previewRequest, setPreviewRequest] = useState(0);
  const [workspaceRoot, setWorkspaceRoot] = useState<string | undefined>();
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspaceMessage, setWorkspaceMessage] = useState<string | undefined>();
  const [theme, setTheme] = useState<Theme>(() => loadTheme());
  const [sessions, setSessions] = useState<SessionEntry[]>(() => loadSessions());

  function openFileFromChat(path: string) {
    setFilePaneCollapsed(false);
    setPreviewPath(path);
    setPreviewRequest((count) => count + 1);
  }

  function cycleTheme() {
    const next = nextTheme(theme);
    setTheme(next);
    saveTheme(next);
    applyTheme(next);
  }

  const taskTitle =
    bubbles.find((b) => b.kind === "user" && b.text.trim().length > 0)?.text ??
    "新对话";

  function syncCurrentSession(bubbleList: Bubble[]) {
    if (
      !bubbleList.some(
        (b) => b.kind === "user" && b.text.trim().length > 0,
      )
    ) {
      return;
    }
    setSessions((prev) =>
      upsertSession(prev, sid.current, titleFromBubbles(bubbleList)),
    );
  }

  function startNewChat() {
    syncCurrentSession(bubbles);
    resetToNewSession();
  }

  async function switchSession(targetId: string) {
    if (targetId === sid.current || sending || waitingAction) return;
    syncCurrentSession(bubbles);
    sid.current = targetId;
    sessionStorage.setItem(SESSION_KEY, targetId);
    setBubbles([]);
    setDraft("");
    setInput("");
    setPendingImages([]);
    setWaitingAction(false);
    setSending(false);
    turnIdRef.current = undefined;
    setPage("chat");
    const session = await fetchSession(targetId);
    if (!session) return;
    const loaded: Bubble[] = [];
    for (const event of session.events) {
      const bubble = bubbleFromHistory(event, allocId());
      if (bubble) loaded.push(bubble);
    }
    setBubbles(loaded);
    const waiting = waitingTurnId(session.events);
    if (waiting) {
      setWaitingAction(true);
      turnIdRef.current = waiting;
    }
  }

  function resetToNewSession() {
    const id = crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, id);
    sid.current = id;
    setBubbles([]);
    setDraft("");
    setInput("");
    setPendingImages([]);
    setWaitingAction(false);
    setSending(false);
    turnIdRef.current = undefined;
    setPage("chat");
  }

  function deleteSession(targetId: string) {
    if (sending || waitingAction) return;
    let remaining: SessionEntry[] = [];
    setSessions((prev) => {
      remaining = removeSession(prev, targetId);
      return remaining;
    });
    if (targetId !== sid.current) return;
    const next = remaining[0];
    if (next) {
      void switchSession(next.id);
    } else {
      resetToNewSession();
    }
  }

  async function chooseWorkspace() {
    const picked = await pickWorkspaceFolder();
    if (!picked) return;
    setWorkspaceBusy(true);
    setWorkspaceMessage(undefined);
    try {
      const next = await setWorkspace(picked);
      setWorkspaceRoot(next);
      setFilePaneKey((key) => key + 1);
      startNewChat();
      refreshModelStatus();
      setWorkspaceMessage("工作区已切换");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === "busy") {
        setWorkspaceMessage("有对话进行中，请稍后再切换");
      } else if (message === "invalid workspace") {
        setWorkspaceMessage("无效工作区：目录需包含 flintloom.yml");
      } else {
        setWorkspaceMessage("切换工作区失败");
      }
    } finally {
      setWorkspaceBusy(false);
    }
  }

  function handleEvent(event: WorkbenchEvent) {
    if (event.type === "user/message") return;
    if (event.type === "turn/start") {
      turnIdRef.current = event.turnId;
      if (cancelWantedRef.current) {
        void cancelTurn(event.turnId).then((ok) => {
          if (ok) {
            setWaitingAction(false);
            setSending(false);
          }
        });
      }
      return;
    }
    if (event.type === "end") {
      if (event.status === "awaiting_action") {
        setWaitingAction(true);
        setSending(false);
      } else if (
        event.status === "ok" ||
        event.status === "failed" ||
        event.status === "cancelled"
      ) {
        setWaitingAction(false);
        setSending(false);
      } else {
        setSending(false);
      }
      return;
    }
    if (event.type === "assistant/chunk") {
      setDraft((current) => current + event.text);
      return;
    }
    if (event.type === "assistant/message") {
      setDraft("");
      setBubbles((prev) => [
        ...prev,
        { id: allocId(), kind: "assistant", text: event.text },
      ]);
      return;
    }
    if (event.type === "a2ui/surface") {
      turnIdRef.current = event.turnId;
    }
    if (event.type === "guard/ask") {
      turnIdRef.current = event.turnId;
    }
    const bubble = bubbleFromHistory(event, allocId());
    if (bubble) setBubbles((prev) => [...prev, bubble]);
  }

  function refreshModelStatus() {
    void fetchModels()
      .then((models) => {
        const chat = models.find((m) => m.kind === "chat");
        setChatConfigured(chat?.configured ?? false);
        const guard = models.find((m) => m.kind === "guard");
        setGuardConfigured(guard?.configured ?? false);
        const asr = models.find((m) => m.kind === "asr");
        setAsrConfigured(asr?.configured ?? false);
        const omni = models.find((m) => m.kind === "omni");
        setOmniConfigured(omni?.configured ?? false);
        const tts = models.find((m) => m.kind === "tts");
        setTtsConfigured(tts?.configured ?? false);
        setHostDown(false);
      })
      .catch(() => setHostDown(true));
  }

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const ac = new AbortController();
    void fetchWorkspace(ac.signal)
      .then((workspace) => {
        setWorkspaceRoot(workspace.workspaceRoot);
      })
      .catch(() => {
        // host may be down; workspace label stays empty
      });
    void fetchModels(ac.signal)
      .then((models) => {
        const chat = models.find((m) => m.kind === "chat");
        setChatConfigured(chat?.configured ?? false);
        const guard = models.find((m) => m.kind === "guard");
        setGuardConfigured(guard?.configured ?? false);
        const asr = models.find((m) => m.kind === "asr");
        setAsrConfigured(asr?.configured ?? false);
        const omni = models.find((m) => m.kind === "omni");
        setOmniConfigured(omni?.configured ?? false);
        const tts = models.find((m) => m.kind === "tts");
        setTtsConfigured(tts?.configured ?? false);
        setHostDown(false);
      })
      .catch(() => {
        setHostDown(true);
      });
    void fetchSession(sid.current).then((session) => {
      if (!session) return;
      const loaded: Bubble[] = [];
      for (const event of session.events) {
        const bubble = bubbleFromHistory(event, allocId());
        if (bubble) loaded.push(bubble);
      }
      setBubbles(loaded);
      if (
        loaded.some(
          (b) => b.kind === "user" && b.text.trim().length > 0,
        )
      ) {
        setSessions((prev) =>
          upsertSession(prev, sid.current, titleFromBubbles(loaded)),
        );
      }
      const waiting = waitingTurnId(session.events);
      if (waiting) {
        setWaitingAction(true);
        turnIdRef.current = waiting;
      }
    });
    return () => ac.abort();
  }, []);

  async function send() {
    const text = input.trim();
    const images = pendingImages.length > 0 ? pendingImages : undefined;
    if ((!text && !images) || sending || waitingAction) return;
    setInput("");
    setPendingImages([]);
    setBubbles((prev) => {
      const next: Bubble[] = [
        ...prev,
        { id: allocId(), kind: "user", text, images },
      ];
      setSessions((sessionsPrev) =>
        upsertSession(sessionsPrev, sid.current, titleFromBubbles(next)),
      );
      return next;
    });
    setSending(true);
    setDraft("");
    turnIdRef.current = undefined;
    cancelWantedRef.current = false;
    try {
      await postTurn(sid.current, text, handleEvent, undefined, images);
    } finally {
      setSending(false);
    }
  }

  async function submitAction(surfaceId: string, name: string, data?: unknown) {
    const turnId = turnIdRef.current;
    if (!turnId || submittingActionRef.current) return;
    submittingActionRef.current = true;
    setSending(true);
    cancelWantedRef.current = false;
    try {
      await postTurnAction(turnId, { surfaceId, name, data }, handleEvent);
    } finally {
      submittingActionRef.current = false;
      setSending(false);
    }
  }

  async function submitGuard(callId: string, decision: "allow" | "deny") {
    const turnId = turnIdRef.current;
    if (!turnId || submittingActionRef.current) return;
    submittingActionRef.current = true;
    setSending(true);
    cancelWantedRef.current = false;
    try {
      await postTurnGuard(turnId, { callId, decision }, handleEvent);
    } finally {
      submittingActionRef.current = false;
      setSending(false);
    }
  }

  async function onCancel() {
    cancelWantedRef.current = true;
    submittingActionRef.current = false;
    const turnId = turnIdRef.current;
    if (!turnId) return;
    const ok = await cancelTurn(turnId);
    if (ok) {
      setWaitingAction(false);
      setSending(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  const navItems: { id: Page; label: string; icon: string }[] = [
    { id: "chat", label: "对话", icon: "💬" },
    { id: "plugins", label: "插件", icon: "🧩" },
    { id: "models", label: "模型", icon: "🤖" },
    { id: "settings", label: "设置", icon: "⚙️" },
  ];

  const allocId = () => String(++nextId.current);

  return (
    <div className="workbench">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-logo" aria-hidden>FL</div>
          <div>
            <h1>FlintLoom</h1>
            <p className="sidebar-brand-sub">Agent Workbench</p>
          </div>
        </div>
        <div className="sidebar-actions">
          <button
            type="button"
            className="btn-pick-workspace"
            disabled={workspaceBusy || hostDown}
            onClick={() => void chooseWorkspace()}
          >
            📁 选择工作区
          </button>
          {workspaceRoot ? (
            <p className="workspace-path" title={workspaceRoot}>
              {formatWorkspaceLabel(workspaceRoot)}
            </p>
          ) : null}
          {workspaceMessage ? (
            <p className="workspace-message">{workspaceMessage}</p>
          ) : null}
          {page === "chat" ? (
            <button type="button" className="btn-new-chat" onClick={startNewChat}>
              ＋ 新建对话
            </button>
          ) : null}
        </div>
        <nav className="sidebar-nav" aria-label="Workbench">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={page === item.id ? "active" : undefined}
              onClick={() => setPage(item.id)}
            >
              <span className="nav-icon" aria-hidden>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
        {page === "chat" && sessions.length > 0 ? (
          <div className="sidebar-history">
            <p className="sidebar-section-label">任务</p>
            <ul className="sidebar-history-list">
              {sessions.map((item) => (
                <li key={item.id} className="sidebar-history-row">
                  <button
                    type="button"
                    className={
                      item.id === sid.current
                        ? "sidebar-history-item active"
                        : "sidebar-history-item"
                    }
                    disabled={sending || waitingAction}
                    onClick={() => void switchSession(item.id)}
                    title={item.title}
                  >
                    {item.title}
                  </button>
                  <button
                    type="button"
                    className="sidebar-history-delete"
                    disabled={sending || waitingAction}
                    aria-label={`删除任务 ${item.title}`}
                    title="删除任务"
                    onClick={(event) => {
                      event.stopPropagation();
                      deleteSession(item.id);
                    }}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="sidebar-status">
          <button
            type="button"
            className="theme-toggle"
            onClick={cycleTheme}
            title={`当前：${THEME_LABELS[theme]}，点击切换`}
            aria-label={`切换色调，当前${THEME_LABELS[theme]}`}
          >
            <span className="theme-toggle-icon" aria-hidden>{THEME_ICONS[theme]}</span>
            <span className="theme-toggle-label">{THEME_LABELS[theme]}</span>
          </button>
          {hostDown ? (
            <span className="status-pill down">host 未连接</span>
          ) : (
            <>
              {chatConfigured === false ? (
                <span className="status-pill warn">chat 未配置</span>
              ) : chatConfigured ? (
                <span className="status-pill ok">chat 已配置</span>
              ) : null}
              {guardConfigured === false ? (
                <span className="status-pill warn">guard 未配置</span>
              ) : guardConfigured ? (
                <span className="status-pill ok">guard 已配置</span>
              ) : null}
            </>
          )}
        </div>
      </aside>
      <div className="main-content">
      {page === "chat" ? (
      <div className="workbench-body">
        <div className="chat-column">
          <header className="chat-header">
            <h2 className="chat-title">{taskTitle}</h2>
            <div className="chat-header-actions">
              {sending ? <span className="chat-status">思考中…</span> : null}
              {waitingAction ? <span className="chat-status">等待操作</span> : null}
            </div>
          </header>
          <main className="log">
            {bubbles.length === 0 && !draft ? (
              <div className="log-empty">
                <p className="log-empty-title">今天我能帮你做什么？</p>
                <p className="log-empty-hint">向工作区说一句话，开始你的任务</p>
              </div>
            ) : null}
            {bubbles.map((bubble) => (
              <div key={bubble.id} className={`message-turn message-${bubble.kind}`}>
                {bubble.kind !== "user" ? (
                  <div className="message-avatar assistant" aria-hidden>AI</div>
                ) : null}
                <div className={`bubble ${bubble.kind}`}>
                {bubble.kind === "user" && (
                  <div className="user-message">
                    {bubble.images?.map((image, index) => (
                      <img
                        key={index}
                        className="user-image-thumb"
                        alt=""
                        src={`data:${image.mime};base64,${image.data}`}
                      />
                    ))}
                    {bubble.text ? <span>{bubble.text}</span> : null}
                  </div>
                )}
                {bubble.kind === "assistant" && (
                  <div className="assistant-row">
                    <span className="assistant-text">{bubble.text}</span>
                    <MessageFileCards
                      text={bubble.text}
                      onOpenFile={openFileFromChat}
                    />
                    {ttsConfigured ? <TtsPlay text={bubble.text} /> : null}
                  </div>
                )}
                {bubble.kind === "error" && bubble.message}
                {bubble.kind === "tool-call" &&
                  `${bubble.name} ${bubble.argsText}`}
                {bubble.kind === "tool-result" && (
                  <div className="tool-result-row">
                    <span>{bubble.text}</span>
                    <MessageFileCards
                      text={bubble.text}
                      onOpenFile={openFileFromChat}
                    />
                  </div>
                )}
                {bubble.kind === "a2ui" && (
                  <A2uiSurface
                    messages={bubble.messages}
                    interactive={
                      waitingAction &&
                      !sending &&
                      bubble.turnId === turnIdRef.current
                    }
                    onAction={(name, data) => {
                      void submitAction(bubble.surfaceId, name, data);
                    }}
                  />
                )}
                {bubble.kind === "guard-ask" && (
                  <div className="guard-ask">
                    <p className="guard-ask-prompt">
                      允许执行工具 <strong>{bubble.tool}</strong>？
                    </p>
                    <div className="guard-ask-actions">
                      <button
                        type="button"
                        className="btn-primary"
                        disabled={
                          !waitingAction ||
                          sending ||
                          bubble.turnId !== turnIdRef.current
                        }
                        onClick={() => void submitGuard(bubble.callId, "allow")}
                      >
                        允许
                      </button>
                      <button
                        type="button"
                        className="btn-ghost"
                        disabled={
                          !waitingAction ||
                          sending ||
                          bubble.turnId !== turnIdRef.current
                        }
                        onClick={() => void submitGuard(bubble.callId, "deny")}
                      >
                        拒绝
                      </button>
                    </div>
                  </div>
                )}
                {bubble.kind === "guard-steward" && (
                  <div
                    className={`guard-steward ${bubble.verdict === "suspicious" ? "warn" : ""}`}
                  >
                    <p className="guard-steward-label">
                      Guard {bubble.verdict === "suspicious" ? "可疑" : "复查"}：
                      <strong>{bubble.tool}</strong>
                    </p>
                    {bubble.summary ? <p>{bubble.summary}</p> : null}
                  </div>
                )}
                </div>
                {bubble.kind === "user" ? (
                  <div className="message-avatar user" aria-hidden>我</div>
                ) : null}
              </div>
            ))}
            {draft ? (
              <div className="message-turn message-assistant">
                <div className="message-avatar assistant" aria-hidden>AI</div>
                <div className="bubble assistant draft">{draft}</div>
              </div>
            ) : null}
          </main>
          <footer className="composer">
            <div className="composer-box">
              {pendingImages.length > 0 ? (
                <div className="composer-images" aria-label="待发送图片">
                  {pendingImages.map((image, index) => (
                    <img
                      key={index}
                      className="composer-image-thumb"
                      alt=""
                      src={`data:${image.mime};base64,${image.data}`}
                    />
                  ))}
                  <button
                    type="button"
                    className="composer-tool-btn"
                    onClick={() => setPendingImages([])}
                  >
                    清除
                  </button>
                </div>
              ) : null}
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                rows={2}
                placeholder="今天我能帮你做什么？"
              />
              <div className="composer-toolbar">
                <div className="composer-tools">
                  {omniConfigured ? (
                    <ImageInput
                      disabled={sending || waitingAction}
                      onImages={(images) =>
                        setPendingImages((current) => [...current, ...images].slice(0, 4))
                      }
                    />
                  ) : null}
                  {asrConfigured ? (
                    <VoiceInput
                      disabled={sending || waitingAction}
                      onText={(text) =>
                        setInput((current) =>
                          current.trim().length > 0 ? `${current.trim()} ${text}` : text,
                        )
                      }
                    />
                  ) : null}
                  {waitingAction || sending ? (
                    <button type="button" className="composer-tool-btn" onClick={() => void onCancel()}>
                      取消
                    </button>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="btn-send"
                  disabled={
                    sending || waitingAction || (!input.trim() && pendingImages.length === 0)
                  }
                  onClick={() => void send()}
                  title="发送"
                >
                  ↑
                </button>
              </div>
            </div>
          </footer>
        </div>
        <FilePane
          key={filePaneKey}
          collapsed={filePaneCollapsed}
          onToggleCollapse={() => setFilePaneCollapsed((v) => !v)}
          onInsertPath={(p) => setInput((cur) => insertPath(cur, p))}
          requestedPath={previewPath}
          previewRequest={previewRequest}
        />
      </div>
      ) : (
        <main className="settings-pane">
          <h2 className="settings-title">
            {page === "plugins"
              ? "插件"
              : page === "models"
                ? "模型"
                : "设置"}
          </h2>
          {page === "plugins" ? (
            <PluginsPane />
          ) : page === "models" ? (
            <ModelsPane onOpenSettings={() => setPage("settings")} />
          ) : (
            <SettingsPane onSaved={refreshModelStatus} />
          )}
        </main>
      )}
      </div>
    </div>
  );
}
