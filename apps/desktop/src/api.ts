import { parseSseBuffer } from "./sse.ts";
import type { UserImage, WorkbenchEvent } from "./types.ts";

const UNREACHABLE: WorkbenchEvent = {
  type: "model/error",
  kind: "chat",
  message: "host unreachable",
};

export async function synthesizeSpeech(text: string, signal?: AbortSignal): Promise<Blob> {
  const res = await fetch("/v1/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal,
  });
  if (res.status === 503) {
    throw new Error("tts not configured");
  }
  if (!res.ok) {
    throw new Error("tts failed");
  }
  const mime = res.headers.get("Content-Type") ?? "audio/wav";
  const bytes = await res.arrayBuffer();
  return new Blob([bytes], { type: mime });
}

export async function transcribeAudio(blob: Blob, signal?: AbortSignal): Promise<string> {
  const res = await fetch("/v1/asr", {
    method: "POST",
    headers: { "Content-Type": blob.type || "application/octet-stream" },
    body: blob,
    signal,
  });
  if (res.status === 503) {
    throw new Error("asr not configured");
  }
  if (!res.ok) {
    throw new Error("asr failed");
  }
  const body = (await res.json()) as { text?: unknown };
  if (typeof body.text !== "string") {
    throw new Error("asr failed");
  }
  return body.text;
}

export async function fetchModels(
  signal?: AbortSignal,
): Promise<{ kind: string; configured: boolean; defaultId: string | null }[]> {
  const res = await fetch("/v1/models", { signal });
  if (!res.ok) throw new Error("host unreachable");
  return (await res.json()) as {
    kind: string;
    configured: boolean;
    defaultId: string | null;
  }[];
}

export async function fetchPlugins(
  signal?: AbortSignal,
): Promise<{ id: string; name: string; status: "loaded" }[]> {
  const res = await fetch("/v1/plugins", { signal });
  if (!res.ok) throw new Error("host unreachable");
  return (await res.json()) as { id: string; name: string; status: "loaded" }[];
}

export async function fetchSession(
  sessionId: string,
): Promise<{ events: WorkbenchEvent[] } | undefined> {
  const res = await fetch(`/v1/sessions/${encodeURIComponent(sessionId)}`);
  if (res.status === 404 || !res.ok) return undefined;
  return (await res.json()) as { events: WorkbenchEvent[] };
}

export async function cancelTurn(turnId: string): Promise<boolean> {
  try {
    const res = await fetch(`/v1/turns/${encodeURIComponent(turnId)}/cancel`, {
      method: "POST",
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function postTurn(
  sessionId: string,
  text: string,
  onEvent: (event: WorkbenchEvent) => void,
  signal?: AbortSignal,
  images?: UserImage[],
): Promise<void> {
  const body: Record<string, unknown> = { sessionId, text };
  if (images !== undefined && images.length > 0) {
    body.images = images;
  }
  await postSse("/v1/turns", body, onEvent, signal);
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

export async function postTurnGuard(
  turnId: string,
  body: { callId: string; decision: "allow" | "deny" },
  onEvent: (event: WorkbenchEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  await postSse(
    `/v1/turns/${encodeURIComponent(turnId)}/guard`,
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
