import type { SessionEvent } from "@flintloom/session";

export type AcpWrite = (method: string, params: unknown) => void;

const TOOL_RESULT_LIMIT = 2000;

export function acpToolKind(toolName: string, args: unknown): string {
  if (toolName === "grep") {
    return "search";
  }
  if (toolName === "shell") {
    return "execute";
  }
  if (toolName === "fs" && isRecord(args)) {
    const action = args.action;
    if (action === "write") {
      return "edit";
    }
    if (action === "list") {
      return "search";
    }
    return "read";
  }
  if (toolName.startsWith("doc_")) {
    return "read";
  }
  return "other";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function truncateToolResult(text: string): string {
  if (text.length <= TOOL_RESULT_LIMIT) {
    return text;
  }
  return `${text.slice(0, TOOL_RESULT_LIMIT)}…`;
}

export function emitAcpSessionEvent(
  sessionId: string,
  event: SessionEvent,
  write: AcpWrite,
): void {
  switch (event.type) {
    case "assistant/chunk":
      write("session/update", {
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: event.text },
        },
      });
      return;
    case "tool/call":
      write("session/update", {
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: event.callId,
          title: event.name,
          kind: acpToolKind(event.name, event.args),
          status: "pending",
          rawInput: event.args,
        },
      });
      write("session/update", {
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: event.callId,
          status: "in_progress",
        },
      });
      return;
    case "guard/steward":
      if (event.verdict === "ok" && event.summary.length === 0) {
        return;
      }
      const stewardLabel =
        event.verdict === "suspicious" ? "suspicious" : "note";
      const stewardText =
        event.summary.length > 0
          ? `Guard steward (${stewardLabel}, ${event.tool}): ${event.summary}`
          : `Guard steward (${stewardLabel}, ${event.tool})`;
      write("session/update", {
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: event.callId,
          content: [
            {
              type: "content",
              content: { type: "text", text: stewardText },
            },
          ],
        },
      });
      return;
    case "tool/result": {
      const text = truncateToolResult(event.text);
      const failed =
        text.startsWith("guard denied") ||
        text.startsWith("Tool not registered") ||
        text.includes("WorkspaceEscapeError");
      write("session/update", {
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: event.callId,
          status: failed ? "failed" : "completed",
          content: [
            {
              type: "content",
              content: { type: "text", text },
            },
          ],
        },
      });
      return;
    }
    default:
      return;
  }
}
