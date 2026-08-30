import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { A2uiSurface } from "./A2uiSurface.tsx";
import { cancelTurn, fetchModels, fetchSession, fetchWorkspace, postTurn, postTurnAction, postTurnGuard, setWorkspace } from "./api.ts";
import { FilePane } from "./FilePane.tsx";
import { FilePaneResizeHandle } from "./FilePaneResizeHandle.tsx";
import { FILE_PANE_COLLAPSED_WIDTH } from "./filePaneWidth.ts";
import { useFilePaneResize } from "./useFilePaneResize.ts";
import { useChatLogFollow } from "./useChatLogFollow.ts";
import { ModelsPane } from "./ModelsPane.tsx";
import { PluginsPane } from "./PluginsPane.tsx";
import { SettingsPane } from "./SettingsPane.tsx";
import { AttachmentInput } from "./AttachmentInput.tsx";
import { OutputFormatInput } from "./OutputFormatInput.tsx";
import { WebSearchToggle } from "./WebSearchToggle.tsx";
import { VoiceInput } from "./VoiceInput.tsx";
import { TtsPlay } from "./TtsPlay.tsx";
import { insertPath, writeNewWorkspaceFile } from "./files.ts";
import {
  appendAttachmentPaths,
  MAX_ATTACHMENTS,
  nextAttachmentPath,
  previewUrlForFile,
  revokeAttachmentPreview,
  type PendingAttachment,
  UPLOADS_DIR,
  visionImagesFrom,
} from "./attachments.ts";
import {
  appendOutputFormatConstraints,
  inferOutputFormats,
  outPathFromToolResult,
  outputFormatOf,
  stripOutputFormatConstraint,
  type OutputFormat,
} from "./outputFormat.ts";
import { FileIcon } from "./FileIcon.tsx";
import {
  applyToolCall,
  applyToolResult,
  buildBubblesFromEvents,
  bubbleFromHistory,
  groupChatTurns,
  statsFromEvents,
  type Bubble,
} from "./chatBubbles.ts";
import { ReasoningRow } from "./ReasoningRow.tsx";
import { AssistantMarkdown } from "./AssistantMarkdown.tsx";
import { SessionStatsLine } from "./SessionStatsLine.tsx";
import { ToolCallRow } from "./ToolCallRow.tsx";
import { TurnFooter } from "./TurnFooter.tsx";
import { turnStatsFromEvent, type TurnStats } from "./turnStats.ts";
import type { WorkbenchEvent } from "./types.ts";
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
import {
  addRecentWorkspace,
  loadRecentWorkspaces,
  type RecentWorkspace,
} from "./workspaceRecent.ts";
import { WorkspacePathDialog } from "./WorkspacePathDialog.tsx";
import {
  formatWorkspaceLabel,
  pickWorkspaceFolder,
  registerWorkspacePathDialog,
} from "./workspacePicker.ts";
import "./app.css";

const SESSION_KEY = "flintloom.sessionId";

type Page = "chat" | "plugins" | "models" | "settings";

function sessionId(): string {
  let id = sessionStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, id);
  }
  return id;
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
  const currentStepRef = useRef<number | undefined>();
  const pendingTurnStatsRef = useRef<TurnStats | undefined>();
  const [hostDown, setHostDown] = useState(false);
  const [chatConfigured, setChatConfigured] = useState<boolean | undefined>();
  const [guardConfigured, setGuardConfigured] = useState<boolean | undefined>();
  const [asrConfigured, setAsrConfigured] = useState(false);
  const [omniConfigured, setOmniConfigured] = useState(false);
  const [ttsConfigured, setTtsConfigured] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const pendingAttachmentsRef = useRef<PendingAttachment[]>([]);
  pendingAttachmentsRef.current = pendingAttachments;
  const [outputFormat, setOutputFormat] = useState<OutputFormat | undefined>();
  const outputFormatForTurnRef = useRef<OutputFormat[]>([]);
  const [webSearch, setWebSearch] = useState(false);
  const [attachError, setAttachError] = useState<string>();
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [draft, setDraft] = useState("");
  const [reasoningDraft, setReasoningDraft] = useState("");
  const reasoningDraftRef = useRef("");
  const reasoningOpenRef = useRef(false);
  const [turnStatsList, setTurnStatsList] = useState<TurnStats[]>([]);
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
  const [recentWorkspaces, setRecentWorkspaces] = useState<RecentWorkspace[]>(() =>
    loadRecentWorkspaces(),
  );
  const [workspaceDialog, setWorkspaceDialog] = useState<{
    resolve: (path: string | undefined) => void;
    initialPath?: string;
  } | null>(null);
  const [theme, setTheme] = useState<Theme>(() => loadTheme());
  const [sessions, setSessions] = useState<SessionEntry[]>(() => loadSessions());
  const workbenchBodyRef = useRef<HTMLDivElement>(null);
  const {
    width: filePaneWidth,
    dragging: filePaneDragging,
    onHandlePointerDown,
    onHandlePointerMove,
    onHandlePointerUp,
    onHandlePointerCancel,
  } = useFilePaneResize({
    stageRef: workbenchBodyRef,
    enabled: page === "chat" && !filePaneCollapsed,
  });
  const logRef = useRef<HTMLElement | null>(null);
  const { onScroll: onLogScroll, onWheel: onLogWheel, pinToBottom } = useChatLogFollow({
    logRef,
    bubbles,
    draft,
    reasoningDraft,
    sending,
  });

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

  function clearPendingAttachments() {
    for (const item of pendingAttachmentsRef.current) {
      revokeAttachmentPreview(item);
    }
    pendingAttachmentsRef.current = [];
    setPendingAttachments([]);
  }

  function removePendingAttachment(id: string) {
    setPendingAttachments((current) => {
      const found = current.find((item) => item.id === id);
      if (found) revokeAttachmentPreview(found);
      return current.filter((item) => item.id !== id);
    });
  }

  function addPendingFiles(files: File[]) {
    void addPendingFilesAsync(files);
  }

  async function addPendingFilesAsync(files: File[]) {
    const used = new Set(pendingAttachmentsRef.current.map((item) => item.path));
    const room = MAX_ATTACHMENTS - pendingAttachmentsRef.current.length;
    const batch = files.slice(0, room);
    const added: PendingAttachment[] = [];
    let failed = 0;
    for (const file of batch) {
      try {
        const dest = nextAttachmentPath(UPLOADS_DIR, file.name, used);
        const path = await writeNewWorkspaceFile(dest, file);
        used.add(path);
        added.push({
          id: crypto.randomUUID(),
          file,
          path,
          previewUrl: previewUrlForFile(file),
        });
      } catch {
        failed += 1;
      }
    }
    if (added.length === 0) {
      if (failed > 0) setAttachError("附件未能写入工作区 uploads/ 目录");
      return;
    }
    setAttachError(undefined);
    setPendingAttachments((current) => [...current, ...added]);
    setFilePaneCollapsed(false);
    const last = added[added.length - 1];
    if (last) openFileFromChat(last.path);
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
    reasoningDraftRef.current = "";
    reasoningOpenRef.current = false;
    setReasoningDraft("");
    setTurnStatsList([]);
    setInput("");
    clearPendingAttachments();
    setOutputFormat(undefined);
    outputFormatForTurnRef.current = [];
    setWaitingAction(false);
    setSending(false);
    turnIdRef.current = undefined;
    setPage("chat");
    pinToBottom();
    const session = await fetchSession(targetId);
    if (!session) return;
    setBubbles(buildBubblesFromEvents(session.events, allocId));
    setTurnStatsList(statsFromEvents(session.events));
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
    reasoningDraftRef.current = "";
    reasoningOpenRef.current = false;
    setReasoningDraft("");
    setTurnStatsList([]);
    setInput("");
    clearPendingAttachments();
    setOutputFormat(undefined);
    outputFormatForTurnRef.current = [];
    setWaitingAction(false);
    setSending(false);
    turnIdRef.current = undefined;
    setPage("chat");
    pinToBottom();
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

  async function switchWorkspace(picked: string) {
    setWorkspaceBusy(true);
    setWorkspaceMessage(undefined);
    try {
      const next = await setWorkspace(picked);
      setWorkspaceRoot(next);
      setRecentWorkspaces((prev) => addRecentWorkspace(next, prev));
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

  async function chooseWorkspace() {
    const picked = await pickWorkspaceFolder(workspaceRoot);
    if (!picked) return;
    await switchWorkspace(picked);
  }

  function closeWorkspaceDialog(path?: string) {
    workspaceDialog?.resolve(path);
    setWorkspaceDialog(null);
  }

  function takeReasoningText(): string {
    const text = reasoningDraftRef.current;
    if (text.length === 0) return "";
    reasoningDraftRef.current = "";
    setReasoningDraft("");
    return text;
  }

  function bubblesWithReasoning(prev: Bubble[], reasoning: string, extra: Bubble[]): Bubble[] {
    const next = [...prev];
    if (reasoning.length > 0) {
      next.push({
        id: allocId(),
        kind: "reasoning",
        text: reasoning,
        open: reasoningOpenRef.current,
      });
    }
    reasoningOpenRef.current = false;
    next.push(...extra);
    return next;
  }

  function handleEvent(event: WorkbenchEvent) {
    if (event.type === "user/message") return;
    if (event.type === "turn/start") {
      turnIdRef.current = event.turnId;
      currentStepRef.current = undefined;
      pendingTurnStatsRef.current = undefined;
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
    if (event.type === "step/start") {
      currentStepRef.current = event.step;
      return;
    }
    if (event.type === "step/stats") {
      return;
    }
    if (event.type === "turn/stats") {
      pendingTurnStatsRef.current = turnStatsFromEvent(event);
      return;
    }
    if (event.type === "end") {
      if (event.status !== "awaiting_action") {
        outputFormatForTurnRef.current = [];
      }
      if (
        event.status === "ok" ||
        event.status === "failed" ||
        event.status === "cancelled"
      ) {
        const pending = pendingTurnStatsRef.current;
        const reasoning = takeReasoningText();
        setBubbles((prev) => {
          const extra: Bubble[] = [];
          if (pending !== undefined) {
            extra.push({
              id: allocId(),
              kind: "turn-footer",
              stats: { ...pending, status: event.status },
            });
          }
          return bubblesWithReasoning(prev, reasoning, extra);
        });
        if (pending !== undefined) {
          setTurnStatsList((prev) => [...prev, { ...pending, status: event.status }]);
          pendingTurnStatsRef.current = undefined;
        }
        currentStepRef.current = undefined;
      } else {
        const leftover = takeReasoningText();
        setBubbles((prev) => bubblesWithReasoning(prev, leftover, []));
      }
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
    if (event.type === "assistant/reasoning-chunk") {
      reasoningDraftRef.current += event.text;
      setReasoningDraft(reasoningDraftRef.current);
      return;
    }
    if (event.type === "assistant/chunk") {
      setDraft((current) => current + event.text);
      return;
    }
    if (event.type === "assistant/message") {
      setDraft("");
      const reasoning = takeReasoningText();
      setBubbles((prev) =>
        bubblesWithReasoning(prev, reasoning, [
          { id: allocId(), kind: "assistant", text: event.text },
        ]),
      );
      return;
    }
    if (event.type === "tool/call") {
      const reasoning = takeReasoningText();
      setBubbles((prev) => {
        const next = bubblesWithReasoning(prev, reasoning, []);
        return applyToolCall(next, event, allocId(), currentStepRef.current);
      });
      return;
    }
    if (event.type === "tool/result") {
      setBubbles((prev) => applyToolResult(prev, event));
      const expected = outputFormatForTurnRef.current;
      for (const format of expected) {
        const out = outPathFromToolResult(event.name, event.text, format);
        if (out) openFileFromChat(out);
      }
      return;
    }
    if (event.type === "a2ui/surface") {
      turnIdRef.current = event.turnId;
    }
    if (event.type === "guard/ask") {
      turnIdRef.current = event.turnId;
    }
    const bubble = bubbleFromHistory(event, allocId());
    if (bubble) {
      const reasoning = takeReasoningText();
      setBubbles((prev) => bubblesWithReasoning(prev, reasoning, [bubble]));
    }
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
    return () => {
      for (const item of pendingAttachmentsRef.current) {
        revokeAttachmentPreview(item);
      }
    };
  }, []);

  useEffect(() => {
    return registerWorkspacePathDialog(({ initialPath }) => {
      return new Promise((resolve) => {
        setWorkspaceDialog({ resolve, initialPath });
      });
    });
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    void fetchWorkspace(ac.signal)
      .then((workspace) => {
        setWorkspaceRoot(workspace.workspaceRoot);
        setRecentWorkspaces((prev) =>
          addRecentWorkspace(workspace.workspaceRoot, prev),
        );
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
      const loaded = buildBubblesFromEvents(session.events, allocId);
      setBubbles(loaded);
      setTurnStatsList(statsFromEvents(session.events));
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
    const typed = input.trim();
    const pending = pendingAttachments;
    if ((!typed && pending.length === 0) || sending || waitingAction) return;
    setSending(true);
    let text = typed;
    let images = undefined;
    try {
      if (pending.length > 0) {
        const paths = pending.map((item) => item.path);
        text = appendAttachmentPaths(typed, paths);
        if (omniConfigured) {
          images = await visionImagesFrom(pending);
        }
      }
    } catch {
      setSending(false);
      return;
    }
    const formats = [
      ...new Set([
        ...(outputFormat ? [outputFormat] : []),
        ...inferOutputFormats(typed),
      ]),
    ];
    const displayText = text;
    if (formats.length > 0) {
      text = appendOutputFormatConstraints(text, formats);
    }
    outputFormatForTurnRef.current = formats;
    setOutputFormat(undefined);
    if (!text && images === undefined) {
      setSending(false);
      return;
    }
    setInput("");
    clearPendingAttachments();
    setBubbles((prev) => {
      const next: Bubble[] = [
        ...prev,
        { id: allocId(), kind: "user", text: displayText, images },
      ];
      setSessions((sessionsPrev) =>
        upsertSession(sessionsPrev, sid.current, titleFromBubbles(next)),
      );
      return next;
    });
    setDraft("");
    reasoningDraftRef.current = "";
    reasoningOpenRef.current = false;
    setReasoningDraft("");
    turnIdRef.current = undefined;
    cancelWantedRef.current = false;
    pinToBottom();
    try {
      await postTurn(sid.current, text, handleEvent, undefined, images, webSearch || undefined);
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

  const composerBusy = sending || waitingAction;
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
          {recentWorkspaces.length > 0 ? (
            <div className="workspace-recent">
              <p className="workspace-recent-label">最近</p>
              <ul className="workspace-recent-list">
                {recentWorkspaces.map((item) => (
                  <li key={item.path}>
                    <button
                      type="button"
                      className={`workspace-recent-item${
                        workspaceRoot === item.path ? " active" : ""
                      }`}
                      title={item.path}
                      disabled={
                        workspaceBusy || hostDown || workspaceRoot === item.path
                      }
                      onClick={() => void switchWorkspace(item.path)}
                    >
                      {formatWorkspaceLabel(item.path)}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
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
      <div className="workbench-body" ref={workbenchBodyRef}>
        <div className="chat-column">
          <header className="chat-header">
            <h2 className="chat-title">{taskTitle}</h2>
            <div className="chat-header-actions">
              {sending ? <span className="chat-status">思考中…</span> : null}
              {waitingAction ? <span className="chat-status">等待操作</span> : null}
            </div>
          </header>
          <main className="log" ref={logRef} onScroll={onLogScroll} onWheel={onLogWheel}>
            {bubbles.length === 0 && !draft && !reasoningDraft ? (
              <div className="log-empty">
                <p className="log-empty-title">今天我能帮你做什么？</p>
                <p className="log-empty-hint">向工作区说一句话，开始你的任务</p>
              </div>
            ) : null}
            {groupChatTurns(bubbles).map((turn) => {
              if (turn.type === "tools") {
                return (
                  <div key={turn.bubbles[0]!.id} className="message-turn message-tool-step">
                    <div className="message-avatar assistant" aria-hidden>AI</div>
                    <div className="bubble tool-step tool-step-stack">
                      {turn.bubbles.map((bubble) => (
                        <ToolCallRow
                          key={bubble.id}
                          name={bubble.name}
                          args={bubble.args}
                          result={bubble.result}
                          state={bubble.state}
                          step={bubble.step}
                          onOpenFile={openFileFromChat}
                        />
                      ))}
                    </div>
                  </div>
                );
              }
              const bubble = turn.bubble;
              return (
              <div key={bubble.id} className={`message-turn message-${bubble.kind}`}>
                {bubble.kind !== "user" && bubble.kind !== "turn-footer" ? (
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
                    {bubble.text ? (
                      <span>{stripOutputFormatConstraint(bubble.text)}</span>
                    ) : null}
                    <MessageFileCards
                      text={stripOutputFormatConstraint(bubble.text)}
                      onOpenFile={openFileFromChat}
                    />
                  </div>
                )}
                {bubble.kind === "assistant" && (
                  <div className="assistant-row">
                    <AssistantMarkdown text={bubble.text} />
                    <MessageFileCards
                      text={bubble.text}
                      onOpenFile={openFileFromChat}
                    />
                    {ttsConfigured ? <TtsPlay text={bubble.text} /> : null}
                  </div>
                )}
                {bubble.kind === "reasoning" && (
                  <ReasoningRow text={bubble.text} defaultOpen={bubble.open} />
                )}
                {bubble.kind === "tool-step" && (
                  <ToolCallRow
                    name={bubble.name}
                    args={bubble.args}
                    result={bubble.result}
                    state={bubble.state}
                    step={bubble.step}
                    onOpenFile={openFileFromChat}
                  />
                )}
                {bubble.kind === "turn-footer" && (
                  <TurnFooter stats={bubble.stats} />
                )}
                {bubble.kind === "error" && bubble.message}
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
              );
            })}
            {reasoningDraft ? (
              <div className="message-turn message-reasoning">
                <div className="message-avatar assistant" aria-hidden>AI</div>
                <div className="bubble reasoning">
                  <ReasoningRow
                    text={reasoningDraft}
                    running
                    onOpenChange={(open) => {
                      reasoningOpenRef.current = open;
                    }}
                  />
                </div>
              </div>
            ) : null}
            {draft ? (
              <div className="message-turn message-assistant">
                <div className="message-avatar assistant" aria-hidden>AI</div>
                <div className="bubble assistant draft">
                  <AssistantMarkdown text={draft} />
                </div>
              </div>
            ) : null}
            {sending && !draft && !reasoningDraft ? (
              <div className="message-turn message-turn-status">
                <div className="message-avatar assistant" aria-hidden>AI</div>
                <div className="bubble turn-status">Deep diving…</div>
              </div>
            ) : null}
          </main>
          <footer className="composer">
            <SessionStatsLine stats={turnStatsList} />
            <div className="composer-box">
              {attachError ? (
                <p className="composer-attach-error">{attachError}</p>
              ) : null}
              {pendingAttachments.length > 0 ? (
                <div className="composer-attachments" aria-label="待发送附件">
                  {pendingAttachments.map((item) => (
                    <span key={item.id} className="composer-attach-chip">
                      <button
                        type="button"
                        className="composer-attach-open"
                        title={`已保存到 ${item.path}`}
                        onClick={() => {
                          setFilePaneCollapsed(false);
                          openFileFromChat(item.path);
                        }}
                      >
                        {item.previewUrl ? (
                          <img
                            className="composer-image-thumb"
                            alt={item.file.name}
                            src={item.previewUrl}
                          />
                        ) : (
                          <FileIcon name={item.file.name} />
                        )}
                        <span className="composer-attach-meta">
                          <span className="composer-attach-name">{item.file.name}</span>
                          <span className="composer-attach-path">{item.path}</span>
                        </span>
                      </button>
                      <button
                        type="button"
                        className="composer-attach-remove"
                        aria-label={`移除 ${item.file.name}`}
                        onClick={() => removePendingAttachment(item.id)}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <button
                    type="button"
                    className="composer-tool-btn"
                    onClick={() => clearPendingAttachments()}
                  >
                    清除
                  </button>
                </div>
              ) : null}
              {outputFormat ? (
                <div className="composer-attachments" aria-label="输出格式">
                  <span className="composer-attach-chip">
                    <span className="composer-attach-meta">
                      <span className="composer-attach-name">
                        将写成 {outputFormatOf(outputFormat).label}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="composer-attach-remove"
                      aria-label="取消输出格式"
                      onClick={() => setOutputFormat(undefined)}
                    >
                      ×
                    </button>
                  </span>
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
                  <AttachmentInput
                    disabled={sending || waitingAction}
                    remaining={MAX_ATTACHMENTS - pendingAttachments.length}
                    onFiles={addPendingFiles}
                  />
                  <WebSearchToggle
                    disabled={sending || waitingAction}
                    value={webSearch}
                    onChange={setWebSearch}
                  />
                  <OutputFormatInput
                    disabled={sending || waitingAction}
                    value={outputFormat}
                    onChange={setOutputFormat}
                  />
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
                </div>
                <button
                  type="button"
                  className={composerBusy ? "btn-send btn-send--stop" : "btn-send"}
                  disabled={
                    !composerBusy && !input.trim() && pendingAttachments.length === 0
                  }
                  onClick={() => {
                    if (composerBusy) {
                      void onCancel();
                      return;
                    }
                    void send();
                  }}
                  title={composerBusy ? "取消" : "发送"}
                  aria-label={composerBusy ? "取消" : "发送"}
                >
                  {composerBusy ? (
                    <span className="btn-send-stop" aria-hidden />
                  ) : (
                    <svg className="btn-send-arrow" viewBox="0 0 24 24" aria-hidden>
                      <path
                        fill="currentColor"
                        d="M3.4 20.4 21.05 12.8c.73-.32.73-1.36 0-1.68L3.4 3.52c-.8-.35-1.64.42-1.35 1.25L4.2 11.1h8.05a.9.9 0 1 1 0 1.8H4.2l-2.15 6.33c-.29.83.55 1.6 1.35 1.25Z"
                      />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </footer>
        </div>
        {filePaneDragging ? <div className="file-pane-drag-overlay" /> : null}
        {!filePaneCollapsed ? (
          <div className="file-pane-split-rail">
            <FilePaneResizeHandle
              onPointerDown={onHandlePointerDown}
              onPointerMove={onHandlePointerMove}
              onPointerUp={onHandlePointerUp}
              onPointerCancel={onHandlePointerCancel}
            />
          </div>
        ) : null}
        <div
          className={`file-pane-rail${filePaneCollapsed ? " file-pane-rail--collapsed" : ""}`}
          style={
            filePaneCollapsed
              ? { width: `${FILE_PANE_COLLAPSED_WIDTH}px` }
              : { width: `${filePaneWidth}px` }
          }
        >
          <FilePane
            key={filePaneKey}
            collapsed={filePaneCollapsed}
            onToggleCollapse={() => setFilePaneCollapsed((v) => !v)}
            onInsertPath={(p) => setInput((cur) => insertPath(cur, p))}
            requestedPath={previewPath}
            previewRequest={previewRequest}
          />
        </div>
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
      {workspaceDialog ? (
        <WorkspacePathDialog
          initialPath={workspaceDialog.initialPath ?? workspaceRoot ?? ""}
          recentPaths={recentWorkspaces.map((item) => item.path)}
          onConfirm={(path) => closeWorkspaceDialog(path)}
          onCancel={() => closeWorkspaceDialog(undefined)}
        />
      ) : null}
    </div>
  );
}
