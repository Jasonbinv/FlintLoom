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

export type McpServerSnapshot = {
  id: string;
  command: string;
  args: string[];
  env: string[];
  enabled: boolean;
  source: "workspace" | "home";
  writable: boolean;
  status: "loaded" | "disabled" | "error";
  tools: string[];
  error: string | null;
};

async function throwIfMcpMutationFailed(res: Response): Promise<void> {
  if (res.status === 409) {
    try {
      const body = (await res.json()) as { written?: unknown };
      if (body.written === true) {
        throw new Error("busy");
      }
    } catch (err) {
      if (err instanceof Error && err.message === "busy") throw err;
    }
    throw new Error("busy");
  }
  if (res.status === 400) {
    const text = (await res.text()).trim();
    throw new Error(text.length > 0 ? text : "invalid");
  }
  if (!res.ok) throw new Error("mcp failed");
}

export async function fetchMcpServers(
  signal?: AbortSignal,
): Promise<{ servers: McpServerSnapshot[] }> {
  const res = await fetch("/v1/mcp-servers", { signal });
  if (!res.ok) throw new Error("host unreachable");
  return (await res.json()) as { servers: McpServerSnapshot[] };
}

export async function createMcpServer(body: {
  id: string;
  command: string;
  args?: string[];
  env?: string[];
}): Promise<void> {
  const res = await fetch("/v1/mcp-servers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  await throwIfMcpMutationFailed(res);
}

export async function updateMcpServer(
  id: string,
  body: { command: string; args?: string[]; env?: string[] },
): Promise<void> {
  const res = await fetch(`/v1/mcp-servers/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  await throwIfMcpMutationFailed(res);
}

export async function setMcpServerEnabled(
  id: string,
  enabled: boolean,
): Promise<{ written?: boolean; busy?: boolean }> {
  const res = await fetch(`/v1/mcp-servers/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  if (res.status === 409) {
    let written = false;
    try {
      const body = (await res.json()) as { written?: unknown };
      written = body.written === true;
    } catch {
      /* text busy */
    }
    return { written: written || undefined, busy: true };
  }
  if (res.status === 400) {
    const text = (await res.text()).trim();
    throw new Error(text.length > 0 ? text : "invalid");
  }
  if (!res.ok) throw new Error("mcp failed");
  return { written: true };
}

export async function deleteMcpServer(id: string): Promise<void> {
  const res = await fetch(`/v1/mcp-servers/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  await throwIfMcpMutationFailed(res);
}

export async function copyMcpServer(id: string): Promise<void> {
  const res = await fetch(`/v1/mcp-servers/${encodeURIComponent(id)}/copy`, {
    method: "POST",
  });
  await throwIfMcpMutationFailed(res);
}

export async function installPlugin(
  sourcePath: string,
  id?: string,
): Promise<{ id: string; dest: string }> {
  const body: { sourcePath: string; id?: string } = { sourcePath };
  if (id !== undefined && id.trim().length > 0) {
    body.id = id.trim();
  }
  const res = await fetch("/v1/plugins/install", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 409) throw new Error("busy");
  if (res.status === 400) {
    const text = (await res.text()).trim();
    throw new Error(text.length > 0 ? text : "invalid");
  }
  if (!res.ok) throw new Error("install failed");
  return (await res.json()) as { id: string; dest: string };
}

export type CredentialSlotSnapshot = {
  id: string;
  label: string;
  configured: boolean;
  source: string;
  baseUrl?: string;
  model?: string;
  appId?: string;
  agentId?: string;
  callbackToken?: string;
  encodingAesKey?: string;
  callbackUrl?: string;
  allowedChatIds?: string;
  maskedKey?: string;
};

export async function fetchCredentialSettings(
  signal?: AbortSignal,
): Promise<{
  slots: CredentialSlotSnapshot[];
  webhook: { url: string; hint: string };
}> {
  const res = await fetch("/v1/settings/credentials", { signal });
  if (!res.ok) throw new Error("host unreachable");
  return (await res.json()) as {
    slots: CredentialSlotSnapshot[];
    webhook: { url: string; hint: string };
  };
}

export async function putCredentialSlot(
  slotId: string,
  body: Record<string, string>,
): Promise<void> {
  const res = await fetch(`/v1/settings/credentials/${encodeURIComponent(slotId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("save failed");
}

export async function reloadHostSettings(): Promise<void> {
  const res = await fetch("/v1/settings/reload", { method: "POST" });
  if (res.status === 409) throw new Error("busy");
  if (!res.ok) throw new Error("reload failed");
}

export async function fetchWorkspace(
  signal?: AbortSignal,
): Promise<{ workspaceRoot: string }> {
  const res = await fetch("/v1/settings/workspace", { signal });
  if (!res.ok) throw new Error("host unreachable");
  return (await res.json()) as { workspaceRoot: string };
}

export async function setWorkspace(workspaceRoot: string): Promise<string> {
  const res = await fetch("/v1/settings/workspace", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceRoot }),
  });
  if (res.status === 409) throw new Error("busy");
  if (res.status === 400) throw new Error("invalid workspace");
  if (!res.ok) throw new Error("workspace switch failed");
  const body = (await res.json()) as { workspaceRoot: string };
  return body.workspaceRoot;
}

export type PickWorkspaceResult =
  | { status: "picked"; path: string }
  | { status: "canceled" }
  | { status: "unsupported" };

/** Open a native folder picker via the local Host (Windows / macOS / Linux). */
export async function pickWorkspaceFromHost(
  initialPath?: string,
  signal?: AbortSignal,
): Promise<PickWorkspaceResult> {
  const res = await fetch("/v1/settings/workspace/pick", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      initialPath !== undefined && initialPath.trim().length > 0
        ? { initialPath }
        : {},
    ),
    signal,
  });
  if (res.status === 501) {
    return { status: "unsupported" };
  }
  if (!res.ok) {
    return { status: "unsupported" };
  }
  const body = (await res.json()) as { canceled?: boolean; path?: string };
  if (body.canceled) {
    return { status: "canceled" };
  }
  if (typeof body.path === "string" && body.path.trim().length > 0) {
    return { status: "picked", path: body.path.trim() };
  }
  return { status: "canceled" };
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
  webSearch?: boolean,
): Promise<void> {
  const body: Record<string, unknown> = { sessionId, text };
  if (images !== undefined && images.length > 0) {
    body.images = images;
  }
  if (webSearch === true) {
    body.webSearch = true;
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
