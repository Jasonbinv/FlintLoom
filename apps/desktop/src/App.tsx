import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { cancelTurn, fetchModels, fetchSession, postTurn } from "./api.ts";
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
  | { id: string; kind: "error"; message: string };

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
    default:
      return undefined;
  }
}

export function App() {
  const sid = useRef(sessionId());
  const nextId = useRef(0);
  const turnIdRef = useRef<string | undefined>();
  const cancelWantedRef = useRef(false);
  const [hostDown, setHostDown] = useState(false);
  const [chatConfigured, setChatConfigured] = useState<boolean | undefined>();
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [draft, setDraft] = useState("");
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const allocId = () => String(++nextId.current);

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
    });
    return () => ac.abort();
  }, []);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setBubbles((prev) => [...prev, { id: allocId(), kind: "user", text }]);
    setSending(true);
    setDraft("");
    turnIdRef.current = undefined;
    cancelWantedRef.current = false;
    try {
      await postTurn(sid.current, text, (event) => {
        if (event.type === "user/message") return;
        if (event.type === "turn/start") {
          turnIdRef.current = event.turnId;
          if (cancelWantedRef.current) void cancelTurn(event.turnId);
          return;
        }
        if (event.type === "end") {
          setSending(false);
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
        const bubble = bubbleFromHistory(event, allocId());
        if (bubble) setBubbles((prev) => [...prev, bubble]);
      });
    } finally {
      setSending(false);
    }
  }

  function onCancel() {
    cancelWantedRef.current = true;
    if (turnIdRef.current) void cancelTurn(turnIdRef.current);
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
            {sending ? (
              <button type="button" onClick={onCancel}>
                取消
              </button>
            ) : (
              <button type="button" onClick={() => void send()}>
                发送
              </button>
            )}
          </footer>
        </div>
        <FilePane
          onInsertPath={(p) => setInput((cur) => insertPath(cur, p))}
        />
      </div>
    </div>
  );
}
