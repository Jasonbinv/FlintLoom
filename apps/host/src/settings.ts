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
import {
  normalizeWorkspaceRoot,
  validateWorkspaceRoot,
  writePersistedWorkspace,
} from "./workspace.ts";
import { isPickFolderSupported, pickFolderNative } from "./pick-folder.ts";

const SLOT_IDS: CredentialSlotId[] = [
  "chat",
  "media",
  "guard",
  "telegram",
  "discord",
  "slack",
  "feishu",
  "wecom",
];

export type CredentialSlotSnapshot = {
  id: CredentialSlotId;
  label: string;
  configured: boolean;
  source: CredentialSource;
  baseUrl?: string;
  model?: string;
  appId?: string;
  allowedChatIds?: string;
  agentId?: string;
  callbackToken?: string;
  encodingAesKey?: string;
  maskedKey?: string;
  callbackUrl?: string;
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

function parseAllowedStringIds(
  raw: string | undefined,
  pattern: RegExp,
): string[] | undefined {
  if (raw === undefined || raw.length === 0) {
    return undefined;
  }
  const ids: string[] = [];
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (trimmed.length === 0) {
      continue;
    }
    if (!pattern.test(trimmed)) {
      return undefined;
    }
    ids.push(trimmed);
  }
  return ids.length > 0 ? ids : undefined;
}

function tokenChannelSlotSnapshot(
  id: CredentialSlotId,
  label: string,
  tokenEnvKey: string,
  idsEnvKey: string,
  idsPattern: RegExp,
  credChannel: Record<string, string> | undefined,
  fileEnv: Record<string, string>,
  idsField: "allowedChatIds" | "allowedChannelIds",
): CredentialSlotSnapshot {
  const tokenLayer = resolveLayeredString(tokenEnvKey, fileEnv, credChannel?.token);
  const idsLayer = resolveLayeredString(idsEnvKey, fileEnv, credChannel?.[idsField]);
  const ids = parseAllowedStringIds(idsLayer.value, idsPattern);
  const configured = tokenLayer.value !== undefined && ids !== undefined;
  return {
    id,
    label,
    configured,
    source: tokenLayer.source !== "none" ? tokenLayer.source : idsLayer.source,
    allowedChatIds: idsLayer.value,
    maskedKey: tokenLayer.value !== undefined ? maskSecret(tokenLayer.value) : undefined,
  };
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

function feishuSlotSnapshot(
  fileEnv: Record<string, string>,
  credStore: ReturnType<typeof readCredentialsStore>,
): CredentialSlotSnapshot {
  const credFeishu = credStore.channels?.feishu;
  const appIdLayer = resolveLayeredString(
    "FLINTLOOM_FEISHU_APP_ID",
    fileEnv,
    credFeishu?.appId,
  );
  const secretLayer = resolveLayeredString(
    "FLINTLOOM_FEISHU_APP_SECRET",
    fileEnv,
    credFeishu?.appSecret,
  );
  const chatIdsLayer = resolveLayeredString(
    "FLINTLOOM_FEISHU_CHAT_IDS",
    fileEnv,
    credFeishu?.allowedChatIds,
  );
  const ids = parseAllowedStringIds(chatIdsLayer.value, /^oc_[\w-]+$/);
  const configured =
    appIdLayer.value !== undefined &&
    secretLayer.value !== undefined &&
    ids !== undefined;
  return {
    id: "feishu",
    label: "飞书",
    configured,
    source:
      secretLayer.source !== "none"
        ? secretLayer.source
        : appIdLayer.source !== "none"
          ? appIdLayer.source
          : chatIdsLayer.source,
    appId: appIdLayer.value,
    allowedChatIds: chatIdsLayer.value,
    maskedKey:
      secretLayer.value !== undefined ? maskSecret(secretLayer.value) : undefined,
  };
}

function wecomSlotSnapshot(
  fileEnv: Record<string, string>,
  credStore: ReturnType<typeof readCredentialsStore>,
  port: number,
): CredentialSlotSnapshot {
  const credWecom = credStore.channels?.wecom;
  const corpIdLayer = resolveLayeredString(
    "FLINTLOOM_WECOM_CORP_ID",
    fileEnv,
    credWecom?.corpId,
  );
  const secretLayer = resolveLayeredString(
    "FLINTLOOM_WECOM_CORP_SECRET",
    fileEnv,
    credWecom?.corpSecret,
  );
  const agentIdLayer = resolveLayeredString(
    "FLINTLOOM_WECOM_AGENT_ID",
    fileEnv,
    credWecom?.agentId,
  );
  const callbackTokenLayer = resolveLayeredString(
    "FLINTLOOM_WECOM_CALLBACK_TOKEN",
    fileEnv,
    credWecom?.callbackToken,
  );
  const encodingLayer = resolveLayeredString(
    "FLINTLOOM_WECOM_ENCODING_AES_KEY",
    fileEnv,
    credWecom?.encodingAesKey,
  );
  const userIdsLayer = resolveLayeredString(
    "FLINTLOOM_WECOM_USER_IDS",
    fileEnv,
    credWecom?.allowedUserIds,
  );
  const ids = parseAllowedStringIds(userIdsLayer.value, /^[\w@.-]+$/);
  const configured =
    corpIdLayer.value !== undefined &&
    secretLayer.value !== undefined &&
    agentIdLayer.value !== undefined &&
    callbackTokenLayer.value !== undefined &&
    ids !== undefined;
  return {
    id: "wecom",
    label: "企业微信",
    configured,
    source:
      secretLayer.source !== "none"
        ? secretLayer.source
        : corpIdLayer.source !== "none"
          ? corpIdLayer.source
          : userIdsLayer.source,
    appId: corpIdLayer.value,
    agentId: agentIdLayer.value,
    allowedChatIds: userIdsLayer.value,
    maskedKey:
      secretLayer.value !== undefined ? maskSecret(secretLayer.value) : undefined,
    callbackToken:
      callbackTokenLayer.value !== undefined
        ? maskSecret(callbackTokenLayer.value)
        : undefined,
    encodingAesKey:
      encodingLayer.value !== undefined ? maskSecret(encodingLayer.value) : undefined,
    callbackUrl: `http://127.0.0.1:${port}/v1/channels/wecom/callback`,
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
      tokenChannelSlotSnapshot(
        "discord",
        "Discord",
        "FLINTLOOM_DISCORD_TOKEN",
        "FLINTLOOM_DISCORD_CHANNEL_IDS",
        /^\d+$/,
        credStore.channels?.discord,
        fileEnv,
        "allowedChannelIds",
      ),
      tokenChannelSlotSnapshot(
        "slack",
        "Slack",
        "FLINTLOOM_SLACK_TOKEN",
        "FLINTLOOM_SLACK_CHANNEL_IDS",
        /^[CG][A-Z0-9]+$/,
        credStore.channels?.slack,
        fileEnv,
        "allowedChannelIds",
      ),
      feishuSlotSnapshot(fileEnv, credStore),
      wecomSlotSnapshot(fileEnv, credStore, port),
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

  if (slotId === "discord" || slotId === "slack") {
    const channels = { ...store.channels };
    const channel = { ...(channels[slotId] ?? {}) };
    const pattern = slotId === "discord" ? /^\d+$/ : /^[CG][A-Z0-9]+$/;
    if ("apiKey" in body) {
      if (typeof body.apiKey !== "string") {
        throw new Error("apiKey");
      }
      if (body.apiKey.length === 0) {
        delete channel.token;
      } else {
        channel.token = body.apiKey;
      }
    }
    if ("allowedChatIds" in body) {
      if (typeof body.allowedChatIds !== "string") {
        throw new Error("allowedChatIds");
      }
      const ids = parseAllowedStringIds(body.allowedChatIds, pattern);
      if (ids === undefined) {
        throw new Error("allowedChatIds");
      }
      channel.allowedChannelIds = body.allowedChatIds;
    }
    channels[slotId] = channel;
    writeCredentialsStore(homeDir, { ...store, hostToken, channels });
    return;
  }

  if (slotId === "feishu") {
    const channels = { ...store.channels };
    const feishu = { ...(channels.feishu ?? {}) };
    if ("appId" in body) {
      if (typeof body.appId !== "string") {
        throw new Error("appId");
      }
      if (body.appId.length === 0) {
        delete feishu.appId;
      } else {
        feishu.appId = body.appId;
      }
    }
    if ("apiKey" in body) {
      if (typeof body.apiKey !== "string") {
        throw new Error("apiKey");
      }
      if (body.apiKey.length === 0) {
        delete feishu.appSecret;
      } else {
        feishu.appSecret = body.apiKey;
      }
    }
    if ("allowedChatIds" in body) {
      if (typeof body.allowedChatIds !== "string") {
        throw new Error("allowedChatIds");
      }
      const ids = parseAllowedStringIds(body.allowedChatIds, /^oc_[\w-]+$/);
      if (ids === undefined) {
        throw new Error("allowedChatIds");
      }
      feishu.allowedChatIds = body.allowedChatIds;
    }
    channels.feishu = feishu;
    writeCredentialsStore(homeDir, { ...store, hostToken, channels });
    return;
  }

  if (slotId === "wecom") {
    const channels = { ...store.channels };
    const wecom = { ...(channels.wecom ?? {}) };
    if ("appId" in body) {
      if (typeof body.appId !== "string") {
        throw new Error("appId");
      }
      if (body.appId.length === 0) {
        delete wecom.corpId;
      } else {
        wecom.corpId = body.appId;
      }
    }
    if ("apiKey" in body) {
      if (typeof body.apiKey !== "string") {
        throw new Error("apiKey");
      }
      if (body.apiKey.length === 0) {
        delete wecom.corpSecret;
      } else {
        wecom.corpSecret = body.apiKey;
      }
    }
    if ("agentId" in body) {
      if (typeof body.agentId !== "string") {
        throw new Error("agentId");
      }
      if (body.agentId.length === 0) {
        delete wecom.agentId;
      } else {
        wecom.agentId = body.agentId;
      }
    }
    if ("callbackToken" in body) {
      if (typeof body.callbackToken !== "string") {
        throw new Error("callbackToken");
      }
      if (body.callbackToken.length === 0) {
        delete wecom.callbackToken;
      } else {
        wecom.callbackToken = body.callbackToken;
      }
    }
    if ("encodingAesKey" in body) {
      if (typeof body.encodingAesKey !== "string") {
        throw new Error("encodingAesKey");
      }
      if (body.encodingAesKey.length === 0) {
        delete wecom.encodingAesKey;
      } else {
        wecom.encodingAesKey = body.encodingAesKey;
      }
    }
    if ("allowedChatIds" in body) {
      if (typeof body.allowedChatIds !== "string") {
        throw new Error("allowedChatIds");
      }
      const ids = parseAllowedStringIds(body.allowedChatIds, /^[\w@.-]+$/);
      if (ids === undefined) {
        throw new Error("allowedChatIds");
      }
      wecom.allowedUserIds = body.allowedChatIds;
    }
    channels.wecom = wecom;
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
    workspaceRootRef: { current: string };
    port: number;
    busy: Set<string>;
    reloadRuntime: () => Promise<void>;
  },
): Promise<boolean> {
  const { pathname, method } = opts;
  const workspaceRoot = opts.workspaceRootRef.current;

  if (method === "GET" && pathname === "/v1/settings/workspace") {
    sendJson(res, 200, { workspaceRoot });
    return true;
  }

  if (method === "POST" && pathname === "/v1/settings/workspace/pick") {
    if (!isPickFolderSupported()) {
      send(res, 501, "unsupported");
      return true;
    }
    let parsed: unknown = {};
    try {
      const text = await readBody(req);
      if (text.trim().length > 0) {
        parsed = JSON.parse(text);
      }
    } catch {
      send(res, 400);
      return true;
    }
    const initialPath =
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      typeof (parsed as { initialPath?: unknown }).initialPath === "string"
        ? (parsed as { initialPath: string }).initialPath.trim()
        : workspaceRoot;
    const result = pickFolderNative(
      initialPath.length > 0 ? initialPath : undefined,
    );
    if (result.status === "canceled") {
      sendJson(res, 200, { canceled: true });
      return true;
    }
    sendJson(res, 200, { canceled: false, path: result.path });
    return true;
  }

  if (method === "POST" && pathname === "/v1/settings/workspace") {
    if (opts.busy.size > 0) {
      send(res, 409, "busy");
      return true;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readBody(req));
    } catch {
      send(res, 400);
      return true;
    }
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      typeof (parsed as { workspaceRoot?: unknown }).workspaceRoot !== "string"
    ) {
      send(res, 400);
      return true;
    }
    const nextRoot = (parsed as { workspaceRoot: string }).workspaceRoot.trim();
    if (!validateWorkspaceRoot(nextRoot)) {
      send(res, 400, "invalid workspace");
      return true;
    }
    const normalized = normalizeWorkspaceRoot(nextRoot);
    if (normalized === opts.workspaceRootRef.current) {
      sendJson(res, 200, { workspaceRoot: normalized, ok: true });
      return true;
    }
    writePersistedWorkspace(opts.homeDir, normalized);
    opts.workspaceRootRef.current = normalized;
    await opts.reloadRuntime();
    sendJson(res, 200, { workspaceRoot: normalized, ok: true });
    return true;
  }

  if (method === "GET" && pathname === "/v1/settings/credentials") {
    sendJson(res, 200, buildCredentialsSnapshot(opts.homeDir, workspaceRoot, opts.port));
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
      slot: snapshotForSlot(opts.homeDir, workspaceRoot, opts.port, slotId),
    });
    return true;
  }

  return false;
}
