import { useState } from "react";
import { MessageFileCards } from "./MessageFileCards.tsx";
import {
  formatToolArgs,
  toolDisplaySummary,
  toolDisplayTitle,
} from "./toolDisplay.ts";

type Props = {
  name: string;
  args: unknown;
  result?: string;
  state: "running" | "done" | "error";
  step?: number;
  onOpenFile?: (path: string) => void;
};

function toolIcon(name: string): string {
  if (name === "fs") return "📄";
  if (name === "grep") return "🔍";
  if (name === "shell") return "⌨";
  if (name === "skill") return "🎯";
  if (name.startsWith("doc_")) return "📝";
  if (name === "a2ui_emit") return "🧩";
  if (name.startsWith("mcp__")) return "🔌";
  return "🛠";
}

export function ToolCallRow({ name, args, result, state, step, onOpenFile }: Props) {
  const [expanded, setExpanded] = useState(false);
  const title = toolDisplayTitle(name);
  const summary = toolDisplaySummary(name, args);
  const argsText = formatToolArgs(args);
  const expandable = argsText.length > 0 || (result !== undefined && result.length > 0);
  const failureLine =
    state === "error" && result !== undefined ? result.split("\n")[0] : undefined;

  return (
    <div className={`disclosure-row tool-row${state === "running" ? " is-running" : ""}`} data-state={state}>
      <button
        type="button"
        className="disclosure-row-header"
        aria-expanded={expanded}
        disabled={!expandable}
        onClick={() => {
          if (expandable) setExpanded((value) => !value);
        }}
      >
        <span className="disclosure-row-icon" aria-hidden>
          {state === "error" ? "✕" : toolIcon(name)}
        </span>
        <span className="disclosure-row-title">{title}</span>
        {step !== undefined ? (
          <>
            <span className="disclosure-row-sep" aria-hidden>
              ·
            </span>
            <span className="disclosure-row-step">step {step}</span>
          </>
        ) : null}
        {!expanded ? (
          <>
            <span className="disclosure-row-sep" aria-hidden>
              ·
            </span>
            <span className={`disclosure-row-summary${failureLine ? " is-error" : ""}`}>
              {failureLine ?? summary}
            </span>
          </>
        ) : null}
        {expandable ? (
          <span className="disclosure-row-chevron" aria-hidden>
            {expanded ? "▾" : "▸"}
          </span>
        ) : null}
      </button>
      {expanded && expandable ? (
        <div className="disclosure-row-body tool-row-body">
          {argsText.length > 0 ? (
            <div className="tool-io-section">
              <span className="tool-io-label">IN</span>
              <pre className="tool-io-text">{argsText}</pre>
            </div>
          ) : null}
          {result !== undefined ? (
            <div className="tool-io-section">
              <span className="tool-io-label">OUT</span>
              <pre className={`tool-io-text${state === "error" ? " is-error" : ""}`}>{result}</pre>
              <MessageFileCards text={result} onOpenFile={onOpenFile} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
