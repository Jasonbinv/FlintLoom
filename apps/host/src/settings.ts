import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import {
  type CredentialSlotId,
  type CredentialSource,
  maskSecret,
  readCredentialsStore,
  resolveLayeredString,
  writeCredentialsStore,
  isLocalLlmBaseUrl,
} from "./credentials.ts";

const SLOT_IDS: CredentialSlotId[] = ["chat", "media", "guard", "telegram"];

export type CredentialSlotSnapshot = {
  id: CredentialSlotId;
  label: string;
  configured: boolean;
  source: CredentialSource;
  baseUrl?: string;
  model?: string;
  allowedChatIds?: string;
  maskedKey?: string;
};

function readWorkspaceDotEnv(workspaceRoot: string): Record<string, string> {
  const filePath = join(workspaceRoot, ".env");
  if (!existsSync(filePath)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function firstNonEmpty(...values: (string | undefined)[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function parseTelegramChatIds(raw: string | undefined): number[] | undefined {
  if (raw === undefined || raw.length === 0) {
    return undefined;
  }
  const ids: number[] = [];
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const n = Number(trimmed);
    if (!Number.isSafeInteger(n)) {
      return undefined;
    }
    ids.push(n);
  }
  return ids.length > 0 ? ids : undefined;
}

function chatSlotSnapshot(
  fileEnv: Record<string, string>,
  credStore: ReturnType<typeof readCredentialsStore>,
): CredentialSlotSnapshot {
  const credChat = credStore.providers?.chat;
  const keyLayer = resolveLayeredString("FLINTLOOM_API_KEY", fileEnv, credChat?.apiKey);
  const baseLayer = resolveLayeredString("FLINTLOOM_BASE_URL", fileEnv, credChat?.baseUrl);
  const baseUrl = baseLayer.value ?? "https://api.deepseek.com/v1";
  const model =
    firstNonEmpty(
      process.env.FLINTLOOM_CHAT_MODEL,
      fileEnv.FLINTLOOM_CHAT_MODEL,
      credChat?.model,
    ) ?? "deepseek-chat";
  return {
    id: "chat",
    label: "Chat / Omni",
    configured: keyLayer.value !== undefined,
    source: keyLayer.source,
    baseUrl,
    model,
    maskedKey: keyLayer.value !== undefined ? maskSecret(keyLayer.value) : undefined,
  };
}

function mediaSlotSnapshot(
  fileEnv: Record<string, string>,
  credStore: ReturnType<typeof readCredentialsStore>,
  chatSnap: CredentialSlotSnapshot,
): CredentialSlotSnapshot {
  const credMedia = credStore.providers?.media;
  const mediaKeyLayer = resolveLayeredString(
    "FLINTLOOM_MEDIA_API_KEY",
    fileEnv,
    credMedia?.apiKey,
  );
  const chatLocal = isLocalLlmBaseUrl(chatSnap.baseUrl ?? "");
  let configured = false;
  let source: CredentialSource = "none";
  let maskedKey: string | undefined;
  if (mediaKeyLayer.source !== "none" && mediaKeyLayer.value !== undefined) {
    configured = true;
    source = mediaKeyLayer.source;
    maskedKey = maskSecret(mediaKeyLayer.value);
  } else if (chatSnap.configured && !chatLocal) {
    configured = true;
    source = chatSnap.source;
    if (chatSnap.maskedKey !== undefined) {
      maskedKey = chatSnap.maskedKey;
    }
  }
  const baseLayer = resolveLayeredString(
    "FLINTLOOM_MEDIA_BASE_URL",
    fileEnv,
    credMedia?.baseUrl,
  );
  const baseUrl =
    mediaKeyLayer.source !== "none"
      ? (baseLayer.value ?? "https://dashscope.aliyuncs.com/compatible-mode/v1")
      : chatSnap.baseUrl;
  return {
    id: "media",
    label: "Media (ASR/TTS/…)",
    configured,
    source,
    baseUrl,
    maskedKey,
  };
}

function guardSlotSnapshot(
  fileEnv: Record<string, string>,
  credStore: ReturnType<typeof readCredentialsStore>,
  chatSnap: CredentialSlotSnapshot,
): CredentialSlotSnapshot {
  const credGuard = credStore.providers?.guard;
  const guardKeyLayer = resolveLayeredString(
    "FLINTLOOM_GUARD_API_KEY",
    fileEnv,
    credGuard?.apiKey,
  );
  const chatLocal = isLocalLlmBaseUrl(chatSnap.baseUrl ?? "");
  let configured = false;
  let source: CredentialSource = "none";
  let maskedKey: string | undefined;
  if (guardKeyLayer.source !== "none" && guardKeyLayer.value !== undefined) {
    configured = true;
    source = guardKeyLayer.source;
    maskedKey = maskSecret(guardKeyLayer.value);
  } else if (chatSnap.configured && !chatLocal) {
    configured = true;
    source = chatSnap.source;
    if (chatSnap.maskedKey !== undefined) {
      maskedKey = chatSnap.maskedKey;
    }
  }
  const baseLayer = resolveLayeredString(
    "FLINTLOOM_GUARD_BASE_URL",
    fileEnv,
    credGuard?.baseUrl,
  );
  const baseUrl =
    guardKeyLayer.source !== "none"
      ? (baseLayer.value ?? "https://api.deepseek.com/v1")
      : chatSnap.baseUrl;
  const model =
    firstNonEmpty(
      process.env.FLINTLOOM_GUARD_MODEL,
      fileEnv.FLINTLOOM_GUARD_MODEL,
      credGuard?.model,
      chatSnap.model,
    ) ?? "deepseek-chat";
  return {
    id: "guard",
    label: "Guard",
    configured,
    source,
    baseUrl,
    model,
    maskedKey,
  };
}

function telegramSlotSnapshot(
  fileEnv: Record<string, string>,
  credStore: ReturnType<typeof readCredentialsStore>,
): CredentialSlotSnapshot {
  const credTelegram = credStore.channels?.telegram;
  const tokenLayer = resolveLayeredString(
    "FLINTLOOM_TELEGRAM_TOKEN",
    fileEnv,
    credTelegram?.token,
  );
  const chatIdsLayer = resolveLayeredString(
    "FLINTLOOM_TELEGRAM_CHAT_IDS",
    fileEnv,
    credTelegram?.allowedChatIds,
  );
  const ids = parseTelegramChatIds(chatIdsLayer.value);
  const configured = tokenLayer.value !== undefined && ids !== undefined;
  return {
    id: "telegram",
    label: "Telegram",
    configured,
    source: tokenLayer.source !== "none" ? tokenLayer.source : chatIdsLayer.source,
    allowedChatIds: chatIdsLayer.value,
    maskedKey: tokenLayer.value !== undefined ? maskSecret(tokenLayer.value) : undefined,
  };
}

export function buildCredentialsSnapshot(
  homeDir: string,
  workspaceRoot: string,
  port: number,
): { slots: CredentialSlotSnapshot[]; webhook: { url: string; hint: string } } {
  const fileEnv = readWorkspaceDotEnv(workspaceRoot);
  const credStore = readCredentialsStore(homeDir);
  const chatSnap = chatSlotSnapshot(fileEnv, credStore);
  return {
    slots: [
      chatSnap,
      mediaSlotSnapshot(fileEnv, credStore, chatSnap),
      guardSlotSnapshot(fileEnv, credStore, chatSnap),
      telegramSlotSnapshot(fileEnv, credStore),
    ],
    webhook: {
      url: `http://127.0.0.1:${port}/v1/hooks`,
      hint: "POST JSON { sessionId, text }；鉴权 Bearer hostToken",
    },
  };
}

export function snapshotForSlot(
  homeDir: string,
  workspaceRoot: string,
  port: number,
  slotId: CredentialSlotId,
): CredentialSlotSnapshot {
  const snap = buildCredentialsSnapshot(homeDir, workspaceRoot, port);
  const slot = snap.slots.find((row) => row.id === slotId);
  if (slot === undefined) {
    throw new Error("slot");
  }
  return slot;
}

export function applyCredentialPatch(
  homeDir: string,
  slotId: CredentialSlotId,
  body: Record<string, unknown>,
): void {
  const store = readCredentialsStore(homeDir);
  const hostToken = store.hostToken;

  if (slotId === "telegram") {
    const channels = { ...store.channels };
    const telegram = { ...channels.telegram };
    if ("apiKey" in body) {
      if (typeof body.apiKey !== "string") {
        throw new Error("apiKey");
      }
      if (body.apiKey.length === 0) {
        delete telegram.token;
      } else {
        telegram.token = body.apiKey;
      }
    }
    if ("allowedChatIds" in body) {
      if (typeof body.allowedChatIds !== "string") {
        throw new Error("allowedChatIds");
      }
      const ids = parseTelegramChatIds(body.allowedChatIds);
      if (ids === undefined) {
        throw new Error("allowedChatIds");
      }
      telegram.allowedChatIds = body.allowedChatIds;
    }
    channels.telegram = telegram;
    writeCredentialsStore(homeDir, { ...store, hostToken, channels });
    return;
  }

  const providers = { ...store.providers };
  const slot = { ...providers[slotId] };
  if ("apiKey" in body) {
    if (typeof body.apiKey !== "string") {
      throw new Error("apiKey");
    }
    if (body.apiKey.length === 0) {
      delete slot.apiKey;
    } else {
      slot.apiKey = body.apiKey;
    }
  }
  if ("baseUrl" in body) {
    if (typeof body.baseUrl !== "string") {
      throw new Error("baseUrl");
    }
    try {
      new URL(body.baseUrl);
    } catch {
      throw new Error("baseUrl");
    }
    if (body.baseUrl.length === 0) {
      delete slot.baseUrl;
    } else {
      slot.baseUrl = body.baseUrl;
    }
  }
  if ("model" in body && (slotId === "chat" || slotId === "guard")) {
    if (typeof body.model !== "string") {
      throw new Error("model");
    }
    if (body.model.length === 0) {
      delete slot.model;
    } else {
      slot.model = body.model;
    }
  }
  providers[slotId] = slot;
  writeCredentialsStore(homeDir, { ...store, hostToken, providers });
}

function send(res: ServerResponse, status: number, body?: string): void {
  res.writeHead(status);
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function handleSettingsRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    pathname: string;
    method: string;
    homeDir: string;
    workspaceRoot: string;
    port: number;
    busy: Set<string>;
    reloadRuntime: () => Promise<void>;
  },
): Promise<boolean> {
  const { pathname, method } = opts;

  if (method === "GET" && pathname === "/v1/settings/credentials") {
    sendJson(res, 200, buildCredentialsSnapshot(opts.homeDir, opts.workspaceRoot, opts.port));
    return true;
  }

  if (method === "POST" && pathname === "/v1/settings/reload") {
    if (opts.busy.size > 0) {
      send(res, 409, "busy");
      return true;
    }
    await opts.reloadRuntime();
    sendJson(res, 200, { ok: true });
    return true;
  }

  const putMatch = /^\/v1\/settings\/credentials\/([^/]+)$/.exec(pathname);
  if (method === "PUT" && putMatch) {
    const slotId = decodeURIComponent(putMatch[1]!) as CredentialSlotId;
    if (!SLOT_IDS.includes(slotId)) {
      send(res, 404);
      return true;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readBody(req));
    } catch {
      send(res, 400);
      return true;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      send(res, 400);
      return true;
    }
    const body = parsed as Record<string, unknown>;
    try {
      applyCredentialPatch(opts.homeDir, slotId, body);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("allowedChatIds")) {
        send(res, 400, "allowedChatIds");
        return true;
      }
      send(res, 400);
      return true;
    }
    sendJson(res, 200, {
      slot: snapshotForSlot(opts.homeDir, opts.workspaceRoot, opts.port, slotId),
    });
    return true;
  }

  return false;
}
