import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { A2uiSurface } from "./A2uiSurface.tsx";
import { cancelTurn, fetchModels, fetchSession, postTurn, postTurnAction } from "./api.ts";
import { FilePane } from "./FilePane.tsx";
import { insertPath } from "./files.ts";
import type { WorkbenchEvent } from "./types.ts";
import "./app.css";

const SESSION_KEY = "flintloom.sessionId";

type Bubble =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "assistant"; text: string }
  | { id: string; kind: "tool-call"; name: string; argsText: string }
  | { id: string; kind: "tool-result"; text: string }
  | { id: string; kind: "error"; message: string }
  | { id: string; kind: "a2ui"; surfaceId: string; messages: unknown[]; turnId: string };

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
      return { id, kind: "user", text: event.text };
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
    default:
      return undefined;
  }
}

function waitingTurnId(events: WorkbenchEvent[]): string | undefined {
  let turnId: string | undefined;
  let ended = false;
  let lastSurfaceWait = false;
  let actionAfterSurface = false;

  for (const event of events) {
    if (event.type === "turn/start") {
      turnId = event.turnId;
      ended = false;
      lastSurfaceWait = false;
      actionAfterSurface = false;
    } else if (event.type === "turn/end") {
      ended = true;
    } else if (event.type === "end") {
      if (event.status !== "awaiting_action") ended = true;
    } else if (event.type === "a2ui/surface") {
      turnId = event.turnId;
      lastSurfaceWait = event.wait;
      actionAfterSurface = false;
    } else if (event.type === "a2ui/action") {
      actionAfterSurface = true;
    }
  }

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
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [draft, setDraft] = useState("");
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [waitingAction, setWaitingAction] = useState(false);

  const allocId = () => String(++nextId.current);

  function handleEvent(event: WorkbenchEvent) {
    if (event.type === "user/message") return;
    if (event.type === "turn/start") {
      turnIdRef.current = event.turnId;
      if (cancelWantedRef.current) void cancelTurn(event.turnId);
      return;
    }
    if (event.type === "end") {
      if (event.status === "awaiting_action") {
        setWaitingAction(true);
        setSending(false);
      } else {
        setWaitingAction(false);
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
    const bubble = bubbleFromHistory(event, allocId());
    if (bubble) setBubbles((prev) => [...prev, bubble]);
  }

  useEffect(() => {
    const ac = new AbortController();
    void fetchModels(ac.signal)
      .then((models) => {
        const chat = models.find((m) => m.kind === "chat");
        setChatConfigured(chat?.configured ?? false);
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
    if (!text || sending || waitingAction) return;
    setInput("");
    setBubbles((prev) => [...prev, { id: allocId(), kind: "user", text }]);
    setSending(true);
    setDraft("");
    turnIdRef.current = undefined;
    cancelWantedRef.current = false;
    try {
      await postTurn(sid.current, text, handleEvent);
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

  function onCancel() {
    cancelWantedRef.current = true;
    submittingActionRef.current = false;
    if (turnIdRef.current) void cancelTurn(turnIdRef.current);
    setWaitingAction(false);
    setSending(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  return (
    <div className="workbench">
      <header className="topbar">
        <h1>FlintLoom</h1>
        {hostDown ? (
          <span>host 未连接</span>
        ) : chatConfigured === false ? (
          <span>chat 未配置</span>
        ) : chatConfigured ? (
          <span>chat 已配置</span>
        ) : null}
      </header>
      <div className="workbench-body">
        <div className="chat-column">
          <main className="log">
            {bubbles.map((bubble) => (
              <div key={bubble.id} className={`bubble ${bubble.kind}`}>
                {bubble.kind === "user" && bubble.text}
                {bubble.kind === "assistant" && bubble.text}
                {bubble.kind === "error" && bubble.message}
                {bubble.kind === "tool-call" &&
                  `${bubble.name} ${bubble.argsText}`}
                {bubble.kind === "tool-result" && bubble.text}
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
              </div>
            ))}
            {draft ? <div className="bubble assistant draft">{draft}</div> : null}
          </main>
          <footer className="composer">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={3}
            />
            <button
              type="button"
              disabled={sending || waitingAction || !input.trim()}
              onClick={() => void send()}
            >
              发送
            </button>
            {waitingAction || sending ? (
              <button type="button" onClick={onCancel}>
                取消
              </button>
            ) : null}
          </footer>
        </div>
        <FilePane
          onInsertPath={(p) => setInput((cur) => insertPath(cur, p))}
        />
      </div>
    </div>
  );
}
