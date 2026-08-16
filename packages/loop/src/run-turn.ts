import {
  ModelKindMissingError,
  type ChatChunkToolCall,
  type ModelRegistry,
} from "@flintloom/models";
import { Session, type SessionEvent } from "@flintloom/session";
import type { ToolRegistry } from "@flintloom/tools";

const SYSTEM_MESSAGE =
  "You are FlintLoom, a real agent. Use tools to work in the workspace.";
const MAX_STEPS = 8;

export interface RunTurnInput {
  session: Session;
  text: string;
  models: ModelRegistry;
  tools: ToolRegistry;
  workspaceRoot: string;
  channel: string;
  signal: AbortSignal;
  onEvent?: (event: SessionEvent) => void;
}

export interface RunTurnResult {
  turnId: string;
  status: "ok" | "failed" | "cancelled";
}

function appendEvent(
  session: Session,
  onEvent: RunTurnInput["onEvent"],
  event: SessionEvent,
): void {
  session.append(event);
  onEvent?.(event);
}

function parseToolArgs(args: unknown): Record<string, unknown> {
  if (typeof args === "string") {
    return JSON.parse(args) as Record<string, unknown>;
  }
  return args as Record<string, unknown>;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function failChat(
  session: Session,
  onEvent: RunTurnInput["onEvent"],
  finish: (status: RunTurnResult["status"]) => RunTurnResult,
  err: unknown,
  kind = "chat",
): RunTurnResult {
  appendEvent(session, onEvent, {
    type: "model/error",
    kind,
    message: errorMessage(err),
  });
  return finish("failed");
}

export async function runTurn(input: RunTurnInput): Promise<RunTurnResult> {
  const {
    session,
    text,
    models,
    tools,
    workspaceRoot,
    channel,
    signal,
    onEvent,
  } = input;

  const turnId = crypto.randomUUID();
  appendEvent(session, onEvent, { type: "turn/start", turnId });
  appendEvent(session, onEvent, { type: "user/message", text });

  const finish = (status: RunTurnResult["status"]): RunTurnResult => {
    appendEvent(session, onEvent, { type: "turn/end", turnId, status });
    return { turnId, status };
  };

  for (let step = 0; step < MAX_STEPS; step++) {
    if (signal.aborted) {
      return finish("cancelled");
    }

    let chat;
    try {
      chat = models.resolveChat();
    } catch (err) {
      if (signal.aborted) {
        return finish("cancelled");
      }
      if (err instanceof ModelKindMissingError) {
        return failChat(session, onEvent, finish, err, err.kind);
      }
      return failChat(session, onEvent, finish, err);
    }

    const messages = [
      { role: "system" as const, content: SYSTEM_MESSAGE },
      ...session.deriveMessages(),
    ];

    let accumulatedText = "";
    const toolCalls: ChatChunkToolCall[] = [];

    try {
      for await (const chunk of chat.stream(
        { messages, tools: tools.schemas() },
        signal,
      )) {
        if (signal.aborted) {
          return finish("cancelled");
        }

        switch (chunk.type) {
          case "text":
            accumulatedText += chunk.text;
            appendEvent(session, onEvent, {
              type: "assistant/chunk",
              text: chunk.text,
            });
            break;
          case "tool_call":
            toolCalls.push(chunk);
            break;
          case "error":
            appendEvent(session, onEvent, {
              type: "model/error",
              kind: "chat",
              message: chunk.message,
            });
            return finish("failed");
        }
      }
    } catch (err) {
      if (signal.aborted) {
        return finish("cancelled");
      }
      return failChat(session, onEvent, finish, err);
    }

    if (signal.aborted) {
      return finish("cancelled");
    }

    if (toolCalls.length === 0) {
      appendEvent(session, onEvent, {
        type: "assistant/message",
        text: accumulatedText,
      });
      return finish("ok");
    }

    for (const call of toolCalls) {
      appendEvent(session, onEvent, {
        type: "tool/call",
        callId: call.id,
        name: call.name,
        args: call.args,
      });

      let resultText: string;
      try {
        resultText = await tools.execute(
          call.name,
          parseToolArgs(call.args),
          { workspaceRoot, signal, channel },
          models,
        );
      } catch (err) {
        if (signal.aborted) {
          return finish("cancelled");
        }
        resultText = err instanceof Error ? err.message : String(err);
      }

      appendEvent(session, onEvent, {
        type: "tool/result",
        callId: call.id,
        name: call.name,
        text: resultText,
      });

      if (signal.aborted) {
        return finish("cancelled");
      }
    }
  }

  return finish("failed");
}
