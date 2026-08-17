import { parseSseBuffer } from "./sse.ts";
import type { WorkbenchEvent } from "./types.ts";

const UNREACHABLE: WorkbenchEvent = {
  type: "model/error",
  kind: "chat",
  message: "host unreachable",
};

export async function fetchModels(
  signal?: AbortSignal,
): Promise<{ kind: string; configured: boolean }[]> {
  const res = await fetch("/v1/models", { signal });
  if (!res.ok) throw new Error("host unreachable");
  return (await res.json()) as { kind: string; configured: boolean }[];
}

export async function fetchSession(
  sessionId: string,
): Promise<{ events: WorkbenchEvent[] } | undefined> {
  const res = await fetch(`/v1/sessions/${encodeURIComponent(sessionId)}`);
  if (res.status === 404 || !res.ok) return undefined;
  return (await res.json()) as { events: WorkbenchEvent[] };
}

export async function cancelTurn(turnId: string): Promise<void> {
  await fetch(`/v1/turns/${encodeURIComponent(turnId)}/cancel`, {
    method: "POST",
  });
}

export async function postTurn(
  sessionId: string,
  text: string,
  onEvent: (event: WorkbenchEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  await postSse("/v1/turns", { sessionId, text }, onEvent, signal);
}

export async function postTurnAction(
  turnId: string,
  body: { surfaceId: string; name: string; context?: unknown; data?: unknown },
  onEvent: (event: WorkbenchEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  await postSse(
    `/v1/turns/${encodeURIComponent(turnId)}/actions`,
    body,
    onEvent,
    signal,
  );
}

async function postSse(
  url: string,
  body: unknown,
  onEvent: (event: WorkbenchEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    onEvent(UNREACHABLE);
    return;
  }

  if (!res.ok) {
    onEvent(UNREACHABLE);
    return;
  }

  const reader = res.body?.getReader();
  if (!reader) {
    onEvent(UNREACHABLE);
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      emitParsed(buffer.endsWith("\n\n") ? buffer : `${buffer}\n\n`, onEvent);
      return;
    }
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSseBuffer(buffer);
    buffer = parsed.rest;
    for (const event of parsed.events) {
      onEvent(event);
      if (event.type === "end") return;
    }
  }
}

function emitParsed(
  buffer: string,
  onEvent: (event: WorkbenchEvent) => void,
): void {
  const { events } = parseSseBuffer(buffer);
  for (const event of events) onEvent(event);
}
