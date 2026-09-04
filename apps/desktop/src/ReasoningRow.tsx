import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { foldLoopingReasoning } from "./foldLoopingReasoning.ts";

function firstLine(text: string): string {
  const newline = text.indexOf("\n");
  return newline === -1 ? text : text.slice(0, newline);
}

function peekTail(text: string, maxChars = 400): string {
  if (text.length <= maxChars) return text;
  return text.slice(-maxChars);
}

type Props = {
  text: string;
  running?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
};

function useReasoningStick(contentKey: number, active: boolean) {
  const ref = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickRef.current = distance < 40;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!active) stickRef.current = true;
  }, [active]);

  useLayoutEffect(() => {
    if (!active) return;
    const el = ref.current;
    if (!el || !stickRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [contentKey, active]);

  return ref;
}

export function ReasoningRow({
  text,
  running = false,
  defaultOpen = false,
  onOpenChange,
}: Props) {
  const [expanded, setExpanded] = useState(defaultOpen);
  const bodyRef = useReasoningStick(text.length, running && expanded);
  const peekRef = useRef<HTMLSpanElement | null>(null);
  const body = running ? text : foldLoopingReasoning(text);
  const preview = firstLine(body).trim();
  const showPeek = !expanded;

  useLayoutEffect(() => {
    if (!showPeek) return;
    const el = peekRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [body, showPeek]);

  function toggleOpen() {
    setExpanded((value) => {
      const next = !value;
      onOpenChange?.(next);
      return next;
    });
  }

  return (
    <div
      className={`reasoning-drawer${running ? " is-running" : ""}${expanded ? " is-expanded" : ""}`}
    >
      <button
        type="button"
        className="reasoning-drawer-header"
        aria-expanded={expanded}
        onClick={toggleOpen}
      >
        <span className="reasoning-drawer-bar">
          <span className="reasoning-drawer-led" aria-hidden />
          <span className="reasoning-drawer-title">{running ? "思考中" : "思考"}</span>
          {!expanded && !running && preview ? (
            <span className="disclosure-row-summary">{preview}</span>
          ) : null}
          <span className="reasoning-drawer-hint">
            {running && !expanded ? (
              <span className="reasoning-drawer-dots" aria-hidden>
                <span />
                <span />
                <span />
              </span>
            ) : null}
          </span>
          <span className="reasoning-drawer-chevron" aria-hidden>
            {expanded ? "▾" : "▸"}
          </span>
        </span>
        {showPeek ? (
          <span ref={peekRef} className="reasoning-peek">
            {peekTail(body)}
          </span>
        ) : null}
      </button>
      {expanded ? (
        <div ref={bodyRef} className="reasoning-body">
          {body}
        </div>
      ) : null}
    </div>
  );
}
