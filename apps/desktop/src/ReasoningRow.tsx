import { useState } from "react";
import { foldLoopingReasoning } from "./foldLoopingReasoning.ts";

function firstLine(text: string): string {
  const newline = text.indexOf("\n");
  return newline === -1 ? text : text.slice(0, newline);
}

function latestLine(text: string): string {
  const visible = text.trimEnd();
  const newline = visible.lastIndexOf("\n");
  return newline === -1 ? visible : visible.slice(newline + 1);
}

type Props = {
  text: string;
  running?: boolean;
};

export function ReasoningRow({ text, running = false }: Props) {
  const [expanded, setExpanded] = useState(false);
  const summary = running ? latestLine(text) : firstLine(text);

  return (
    <div className={`disclosure-row reasoning-row${running ? " is-running" : ""}`}>
      <button
        type="button"
        className="disclosure-row-header"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="disclosure-row-icon" aria-hidden>
          💭
        </span>
        <span className="disclosure-row-title">Think</span>
        {!expanded ? (
          <>
            <span className="disclosure-row-sep" aria-hidden>
              ·
            </span>
            <span className="disclosure-row-summary">{summary}</span>
          </>
        ) : null}
        <span className="disclosure-row-chevron" aria-hidden>
          {expanded ? "▾" : "▸"}
        </span>
      </button>
      {expanded ? (
        <div className="disclosure-row-body reasoning-body">
          {running ? text : foldLoopingReasoning(text)}
        </div>
      ) : null}
    </div>
  );
}
