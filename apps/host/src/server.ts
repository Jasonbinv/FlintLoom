import { createReadStream, existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import type { ChannelRegistry } from "@flintloom/channel";
import { applyConfig, Context, loadConfig, mergeMcpServersIntoConfig } from "@flintloom/kernel";
import type { LoopService, RunTurnResult } from "@flintloom/loop";
import type { ModelRegistry } from "@flintloom/models";
import { ModelKindMissingError } from "@flintloom/models";
import type { Session, SessionEvent, SessionStore } from "@flintloom/session";
import { WorkspaceEscapeError } from "@flintloom/tools";
import { cancelWaitingTurn, handleTurnActions, sessionHasWaitingTurn } from "./a2ui.ts";
import { handleTurnGuard } from "./guard.ts";
import { handleSettingsRequest } from "./settings.ts";
import { handlePluginInstallRequest } from "./plugin-install.ts";
import { handleWecomCallback } from "@flintloom/channel-wecom";
import type { WecomConfig } from "@flintloom/channel-wecom";
import {
  contentTypeForFileName,
  parseByteRangeHeader,
  createWorkspaceDirectory,
  createWorkspaceFile,
  deleteWorkspaceEntry,
  listWorkspaceFiles,
  normalizeRelPath,
  previewWorkspaceFile,
  rawFileMaxBytes,
  readWorkspaceFileBytes,
  readWorkspaceFileMarkdown,
  renameWorkspaceEntry,
  resolveWorkspaceReadableFile,
  writeWorkspaceFileBytes,
  writeWorkspaceFileFromMarkdown,
  FILE_RAW_MAX_BYTES,
  type FileMutationResult,
} from "./files.ts";
import {
  buildSafeHtmlWrapperHtml,
  createSafeHtmlPreviewToken,
  readSafeHtmlBytes,
  resolveSafeHtmlToken,
} from "./safeHtmlPreview.ts";
import { handleKnowledgeRequest } from "./knowledge.ts";
import { ASR_MAX_BYTES, readBodyBytes, transcribeAudio } from "./asr.ts";
import { synthesizeSpeech } from "./tts.ts";
import { parseTurnBody } from "./turn-body.ts";
import { loadOrCreateToken, readCredentials } from "./token.ts";
import { readCredentialsStore, type CredentialsStore, resolveLayeredString, isLocalLlmBaseUrl } from "./credentials.ts";
import { resolveWorkspaceRoot } from "./workspace.ts";
import { workspaceSessionsDir } from "./sessionsDir.ts";
import { createFileWatch, type FileWatch } from "./fileWatch.ts";

export type PluginSnapshot = {
  id: string;
  name: string;
  status: "loaded";
};

export type Runtime = {
  ctx: Context;
  stop: () => void;
  plugins: PluginSnapshot[];
};

function readDotEnv(filePath: string): Record<string, string> {
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

function resolveTelegramOverlay(
  fileEnv: Record<string, string>,
  credStore: CredentialsStore,
): { token: string; allowedChatIds: number[] } | undefined {
  const credTelegram = credStore.channels?.telegram;
  const token = resolveLayeredString(
    "FLINTLOOM_TELEGRAM_TOKEN",
    fileEnv,
    credTelegram?.token,
  ).value;
  if (token === undefined) {
    return undefined;
  }
  const allowedChatIds = parseTelegramChatIds(
    resolveLayeredString(
      "FLINTLOOM_TELEGRAM_CHAT_IDS",
      fileEnv,
      credTelegram?.allowedChatIds,
    ).value,
  );
  if (allowedChatIds === undefined) {
    return undefined;
  }
  return { token, allowedChatIds };
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

function resolveDiscordOverlay(
  fileEnv: Record<string, string>,
  credStore: CredentialsStore,
): { token: string; allowedChannelIds: string[] } | undefined {
  const credDiscord = credStore.channels?.discord;
  const token = resolveLayeredString(
    "FLINTLOOM_DISCORD_TOKEN",
    fileEnv,
    credDiscord?.token,
  ).value;
  if (token === undefined) {
    return undefined;
  }
  const allowedChannelIds = parseAllowedStringIds(
    resolveLayeredString(
      "FLINTLOOM_DISCORD_CHANNEL_IDS",
      fileEnv,
      credDiscord?.allowedChannelIds,
    ).value,
    /^\d+$/,
  );
  if (allowedChannelIds === undefined) {
    return undefined;
  }
  return { token, allowedChannelIds };
}

function resolveSlackOverlay(
  fileEnv: Record<string, string>,
  credStore: CredentialsStore,
): { token: string; allowedChannelIds: string[] } | undefined {
  const credSlack = credStore.channels?.slack;
  const token = resolveLayeredString(
    "FLINTLOOM_SLACK_TOKEN",
    fileEnv,
    credSlack?.token,
  ).value;
  if (token === undefined) {
    return undefined;
  }
  const allowedChannelIds = parseAllowedStringIds(
    resolveLayeredString(
      "FLINTLOOM_SLACK_CHANNEL_IDS",
      fileEnv,
      credSlack?.allowedChannelIds,
    ).value,
    /^[CG][A-Z0-9]+$/,
  );
  if (allowedChannelIds === undefined) {
    return undefined;
  }
  return { token, allowedChannelIds };
}

function resolveFeishuOverlay(
  fileEnv: Record<string, string>,
  credStore: CredentialsStore,
): { appId: string; appSecret: string; allowedChatIds: string[] } | undefined {
  const credFeishu = credStore.channels?.feishu;
  const appId = resolveLayeredString(
    "FLINTLOOM_FEISHU_APP_ID",
    fileEnv,
    credFeishu?.appId,
  ).value;
  const appSecret = resolveLayeredString(
    "FLINTLOOM_FEISHU_APP_SECRET",
    fileEnv,
    credFeishu?.appSecret,
  ).value;
  if (appId === undefined || appSecret === undefined) {
    return undefined;
  }
  const allowedChatIds = parseAllowedStringIds(
    resolveLayeredString(
      "FLINTLOOM_FEISHU_CHAT_IDS",
      fileEnv,
      credFeishu?.allowedChatIds,
    ).value,
    /^oc_[\w-]+$/,
  );
  if (allowedChatIds === undefined) {
    return undefined;
  }
  return { appId, appSecret, allowedChatIds };
}

function resolveWecomOverlay(
  fileEnv: Record<string, string>,
  credStore: CredentialsStore,
): {
  corpId: string;
  corpSecret: string;
  agentId: string;
  callbackToken: string;
  encodingAesKey?: string;
  allowedUserIds: string[];
} | undefined {
  const credWecom = credStore.channels?.wecom;
  const corpId = resolveLayeredString(
    "FLINTLOOM_WECOM_CORP_ID",
    fileEnv,
    credWecom?.corpId,
  ).value;
  const corpSecret = resolveLayeredString(
    "FLINTLOOM_WECOM_CORP_SECRET",
    fileEnv,
    credWecom?.corpSecret,
  ).value;
  const agentId = resolveLayeredString(
    "FLINTLOOM_WECOM_AGENT_ID",
    fileEnv,
    credWecom?.agentId,
  ).value;
  const callbackToken = resolveLayeredString(
    "FLINTLOOM_WECOM_CALLBACK_TOKEN",
    fileEnv,
    credWecom?.callbackToken,
  ).value;
  const encodingAesKey = resolveLayeredString(
    "FLINTLOOM_WECOM_ENCODING_AES_KEY",
    fileEnv,
    credWecom?.encodingAesKey,
  ).value;
  if (
    corpId === undefined ||
    corpSecret === undefined ||
    agentId === undefined ||
    callbackToken === undefined
  ) {
    return undefined;
  }
  const allowedUserIds = parseAllowedStringIds(
    resolveLayeredString(
      "FLINTLOOM_WECOM_USER_IDS",
      fileEnv,
      credWecom?.allowedUserIds,
    ).value,
    /^[\w@.-]+$/,
  );
  if (allowedUserIds === undefined) {
    return undefined;
  }
  return {
    corpId,
    corpSecret,
    agentId,
    callbackToken,
    ...(encodingAesKey !== undefined ? { encodingAesKey } : {}),
    allowedUserIds,
  };
}

export async function createRuntime(
  workspaceRoot: string,
  homeDir: string,
  opts?: { pollChannels?: boolean },
): Promise<Runtime> {
  const ymlPath = join(workspaceRoot, "flintloom.yml");
  if (!existsSync(ymlPath)) {
    throw new Error("plugins");
  }
  const fileEnv = readDotEnv(join(workspaceRoot, ".env"));
  const credStore = readCredentialsStore(homeDir);
  const config = mergeMcpServersIntoConfig(
    loadConfig(readFileSync(ymlPath, "utf8")),
    { workspaceRoot, homeDir, fileEnv },
  );
  const credChat = credStore.providers?.chat;
  const chatKeyLayer = resolveLayeredString(
    "FLINTLOOM_API_KEY",
    fileEnv,
    credChat?.apiKey,
  );
  const apiKey = chatKeyLayer.value;
  const chatBaseUrl =
    resolveLayeredString("FLINTLOOM_BASE_URL", fileEnv, credChat?.baseUrl).value ??
    "https://api.deepseek.com/v1";
  const chatUsesLocalLlm = isLocalLlmBaseUrl(chatBaseUrl);
  const runtimeConfigById: Record<string, Record<string, unknown>> = {};

  if (apiKey !== undefined) {
    runtimeConfigById["models-chat"] = {
      apiKey,
      baseUrl: chatBaseUrl,
      model:
        firstNonEmpty(
          process.env.FLINTLOOM_CHAT_MODEL,
          fileEnv.FLINTLOOM_CHAT_MODEL,
          credChat?.model,
        ) ?? "deepseek-chat",
    };
  }

  const credMedia = credStore.providers?.media;
  const mediaKeyLayer = resolveLayeredString(
    "FLINTLOOM_MEDIA_API_KEY",
    fileEnv,
    credMedia?.apiKey,
  );
  let mediaApiKey = mediaKeyLayer.value;
  const explicitMediaConfigured =
    resolveLayeredString("FLINTLOOM_MEDIA_API_KEY", fileEnv, credMedia?.apiKey).source !==
    "none";
  if (mediaApiKey === undefined && apiKey !== undefined && !chatUsesLocalLlm) {
    mediaApiKey = apiKey;
  }
  if (mediaApiKey !== undefined) {
    const mediaBaseUrl = explicitMediaConfigured
      ? (resolveLayeredString(
          "FLINTLOOM_MEDIA_BASE_URL",
          fileEnv,
          credMedia?.baseUrl,
        ).value ?? "https://dashscope.aliyuncs.com/compatible-mode/v1")
      : chatBaseUrl;
    runtimeConfigById["models-media"] = {
      apiKey: mediaApiKey,
      baseUrl: mediaBaseUrl,
    };
  }

  const credGuard = credStore.providers?.guard;
  const guardKeyLayer = resolveLayeredString(
    "FLINTLOOM_GUARD_API_KEY",
    fileEnv,
    credGuard?.apiKey,
  );
  let guardApiKey = guardKeyLayer.value;
  const explicitGuardConfigured =
    resolveLayeredString("FLINTLOOM_GUARD_API_KEY", fileEnv, credGuard?.apiKey).source !==
    "none";
  if (guardApiKey === undefined && apiKey !== undefined && !chatUsesLocalLlm) {
    guardApiKey = apiKey;
  }
  if (guardApiKey !== undefined) {
    const guardBaseUrl = explicitGuardConfigured
      ? (resolveLayeredString(
          "FLINTLOOM_GUARD_BASE_URL",
          fileEnv,
          credGuard?.baseUrl,
        ).value ?? "https://api.deepseek.com/v1")
      : chatBaseUrl;
    runtimeConfigById["models-guard"] = {
      apiKey: guardApiKey,
      baseUrl: guardBaseUrl,
      model:
        firstNonEmpty(
          process.env.FLINTLOOM_GUARD_MODEL,
          fileEnv.FLINTLOOM_GUARD_MODEL,
          credGuard?.model,
        ) ??
        firstNonEmpty(
          process.env.FLINTLOOM_CHAT_MODEL,
          fileEnv.FLINTLOOM_CHAT_MODEL,
          credChat?.model,
        ) ??
        "deepseek-chat",
    };
  }
  runtimeConfigById.knowledge = {
    dbPath: join(homeDir, ".flintloom", "knowledge.sqlite"),
  };
  runtimeConfigById.session = {
    sessionsDir: workspaceSessionsDir(homeDir, workspaceRoot),
  };
  runtimeConfigById.skill = {
    homeDir,
  };
  const searchProvider = resolveLayeredString(
    "FLINTLOOM_SEARCH_PROVIDER",
    fileEnv,
    undefined,
  ).value;
  const searxngUrl = resolveLayeredString(
    "FLINTLOOM_SEARXNG_URL",
    fileEnv,
    undefined,
  ).value;
  const tavilyApiKey = resolveLayeredString(
    "FLINTLOOM_TAVILY_API_KEY",
    fileEnv,
    undefined,
  ).value;
  const braveApiKey = resolveLayeredString(
    "FLINTLOOM_BRAVE_API_KEY",
    fileEnv,
    undefined,
  ).value;
  const bochaApiKey = resolveLayeredString(
    "FLINTLOOM_BOCHA_API_KEY",
    fileEnv,
    undefined,
  ).value;
  runtimeConfigById["web-search"] = {
    ...(searchProvider ? { provider: searchProvider } : {}),
    ...(searxngUrl ? { searxngUrl } : {}),
    ...(tavilyApiKey ? { tavilyApiKey } : {}),
    ...(braveApiKey ? { braveApiKey } : {}),
    ...(bochaApiKey ? { bochaApiKey } : {}),
  };

  if (opts?.pollChannels === true) {
    const telegram = resolveTelegramOverlay(fileEnv, credStore);
    runtimeConfigById["channel-telegram"] = {
      workspaceRoot,
      poll: true,
      ...(telegram ?? {}),
    };
    const discord = resolveDiscordOverlay(fileEnv, credStore);
    runtimeConfigById["channel-discord"] = {
      workspaceRoot,
      poll: true,
      ...(discord ?? {}),
    };
    const slack = resolveSlackOverlay(fileEnv, credStore);
    runtimeConfigById["channel-slack"] = {
      workspaceRoot,
      poll: true,
      ...(slack ?? {}),
    };
    const feishu = resolveFeishuOverlay(fileEnv, credStore);
    runtimeConfigById["channel-feishu"] = {
      workspaceRoot,
      poll: true,
      ...(feishu ?? {}),
    };
  }

  const wecom = resolveWecomOverlay(fileEnv, credStore);
  if (wecom !== undefined) {
    runtimeConfigById["channel-wecom"] = {
      workspaceRoot,
      corpId: wecom.corpId,
      corpSecret: wecom.corpSecret,
      agentId: wecom.agentId,
      callbackToken: wecom.callbackToken,
      ...(wecom.encodingAesKey !== undefined
        ? { encodingAesKey: wecom.encodingAesKey }
        : {}),
      allowedUserIds: wecom.allowedUserIds,
    };
  }

  const ctx = new Context();
  ctx.provide("turnBusy", new Set<string>());
  const stop = await applyConfig(ctx, config, {
    runtimeConfigById,
    workspaceRoot,
  });
  const plugins: PluginSnapshot[] = config.plugins.map((row) => ({
    id: row.id,
    name: row.name,
    status: "loaded",
  }));
  return { ctx, stop, plugins };
}

function formatHostError(
  err: unknown,
  homeDir: string,
  workspaceRoot?: string,
): string {
  let message = err instanceof Error ? err.message : String(err);
  if (message.length === 0) {
    message = "internal error";
  }
  const secrets: string[] = [];
  const envKey = process.env.FLINTLOOM_API_KEY;
  if (typeof envKey === "string" && envKey.length > 0) {
    secrets.push(envKey);
  }
  if (workspaceRoot !== undefined) {
    const fileKey = readDotEnv(join(workspaceRoot, ".env")).FLINTLOOM_API_KEY;
    if (typeof fileKey === "string" && fileKey.length > 0) {
      secrets.push(fileKey);
    }
  }
  const credKey = readCredentials(homeDir).chatApiKey;
  const credStore = readCredentialsStore(homeDir);
  const credChatKey = credStore.providers?.chat?.apiKey;
  if (typeof credKey === "string" && credKey.length > 0) {
    secrets.push(credKey);
  }
  if (typeof credChatKey === "string" && credChatKey.length > 0 && credChatKey !== credKey) {
    secrets.push(credChatKey);
  }
  for (const secret of secrets) {
    if (message.includes(secret)) {
      message = message.split(secret).join("[redacted]");
    }
  }
  return message;
}

function send(res: ServerResponse, status: number, body?: string): void {
  res.writeHead(status);
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function sendFileMutation(res: ServerResponse, result: FileMutationResult): void {
  if (result === "ok") {
    sendJson(res, 200, { ok: true });
    return;
  }
  if (result === "exists") {
    send(res, 409, "exists");
    return;
  }
  if (result === "invalid") {
    send(res, 400, "invalid path");
    return;
  }
  send(res, 404);
}

async function readJsonObject(
  req: IncomingMessage,
): Promise<Record<string, unknown> | "invalid"> {
  const raw = await readBody(req);
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return "invalid";
    }
    return parsed as Record<string, unknown>;
  } catch {
    return "invalid";
  }
}

function stringField(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === "string" ? value : undefined;
}

function writeSse(res: ServerResponse, data: unknown): void {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export async function streamLoopResult(
  req: IncomingMessage,
  res: ServerResponse,
  session: Session,
  controllers: Map<string, AbortController>,
  turns: Map<string, Session>,
  work: (args: {
    signal: AbortSignal;
    onEvent: (event: SessionEvent) => void;
  }) => Promise<RunTurnResult>,
  knownTurnId?: string,
): Promise<void> {
  const controller = new AbortController();
  const onClose = () => {
    controller.abort();
  };
  let boundTurnId = knownTurnId;

  try {
    if (knownTurnId !== undefined) {
      if (controllers.has(knownTurnId)) {
        send(res, 409);
        return;
      }
      turns.set(knownTurnId, session);
      controllers.set(knownTurnId, controller);
    }

    req.on("close", onClose);

    const ensureSse = (): void => {
      if (!res.headersSent) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
      }
    };

    const result = await work({
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === "turn/start") {
          boundTurnId = event.turnId;
          turns.set(event.turnId, session);
          if (controllers.get(event.turnId) === undefined) {
            controllers.set(event.turnId, controller);
          }
        }
        if (event.type === "turn/end") {
          turns.delete(event.turnId);
          if (controllers.get(event.turnId) === controller) {
            controllers.delete(event.turnId);
          }
        }
        ensureSse();
        writeSse(res, event);
      },
    });

    if (result.status === "awaiting_action") {
      req.off("close", onClose);
    } else {
      turns.delete(result.turnId);
    }
    ensureSse();
    writeSse(res, { type: "end", status: result.status });
    res.end();
  } catch (err) {
    const waiting = boundTurnId !== undefined && session.isWaiting(boundTurnId);
    const notWaiting = err instanceof Error && err.message.includes("not waiting");
    if (!res.headersSent) {
      if (notWaiting) {
        send(res, 409);
      } else {
        send(res, 500);
      }
      return;
    }
    if (waiting) {
      writeSse(res, {
        type: "model/error",
        kind: "chat",
        message: err instanceof Error ? err.message : String(err),
      });
      writeSse(res, { type: "end", status: "awaiting_action" });
      res.end();
      return;
    }
    writeSse(res, { type: "end", status: "failed" });
    res.end();
  } finally {
    req.off("close", onClose);
    if (boundTurnId !== undefined && controllers.get(boundTurnId) === controller) {
      controllers.delete(boundTurnId);
    }
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseHookBody(raw: string): { text: string; sessionId: string } | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") {
      return undefined;
    }
    const obj = parsed as { text?: unknown; sessionId?: unknown };
    if (typeof obj.text !== "string") {
      return undefined;
    }
    if (obj.sessionId !== undefined && typeof obj.sessionId !== "string") {
      return undefined;
    }
    const text = obj.text.trim();
    if (text.length === 0) {
      return undefined;
    }
    const sessionRaw = typeof obj.sessionId === "string" ? obj.sessionId.trim() : "";
    return {
      text,
      sessionId: sessionRaw.length > 0 ? sessionRaw : "webhook",
    };
  } catch {
    // invalid JSON
  }
  return undefined;
}

function isAuthorized(req: IncomingMessage, token: string): boolean {
  return req.headers.authorization === `Bearer ${token}`;
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    token: string;
    workspaceRootRef: { current: string };
    homeDir: string;
    port: number;
    runtimeRef: { current: Runtime };
    controllers: Map<string, AbortController>;
    turns: Map<string, Session>;
    busy: Set<string>;
    reloadRuntime: () => Promise<void>;
    fileWatch: FileWatch;
  },
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const pathname = url.pathname;
  const runtime = opts.runtimeRef.current;
  const busy = opts.busy;
  const workspaceRoot = opts.workspaceRootRef.current;

  if (
    await handleWecomCallback(req, res, {
      pathname,
      method: req.method ?? "GET",
      config: runtime.ctx.get<WecomConfig>("wecomConfig"),
      channels: runtime.ctx.get<ChannelRegistry>("channels"),
      busy: opts.busy,
      workspaceRoot,
    })
  ) {
    return;
  }

  if (req.method === "GET" && pathname === "/v1/files/safe-html") {
    const token = url.searchParams.get("t");
    const entry = resolveSafeHtmlToken(token);
    if (!entry || entry.workspaceRoot !== workspaceRoot) {
      send(res, 404, "not found");
      return;
    }
    const html = buildSafeHtmlWrapperHtml(opts.port, token!, entry.relPath);
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'none'; frame-src http://127.0.0.1:*; style-src 'unsafe-inline'; base-uri 'none'",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(html);
    return;
  }

  if (req.method === "GET" && pathname === "/v1/files/safe-html/content") {
    const token = url.searchParams.get("t");
    const entry = resolveSafeHtmlToken(token);
    if (!entry || entry.workspaceRoot !== workspaceRoot) {
      send(res, 404, "not found");
      return;
    }
    try {
      const bytes = await readSafeHtmlBytes(workspaceRoot, entry.relPath);
      if (bytes === "not_found") {
        send(res, 404, "not found");
        return;
      }
      if (bytes === "too_large") {
        send(res, 413, "too large");
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      });
      res.end(bytes);
    } catch (err) {
      if (err instanceof WorkspaceEscapeError) {
        send(res, 400, err.message);
        return;
      }
      throw err;
    }
    return;
  }

  if (pathname.startsWith("/v1/") && !isAuthorized(req, opts.token)) {
    send(res, 401);
    return;
  }

  if (req.method === "POST" && pathname === "/v1/files/safe-html/open") {
    const raw = await readBody(req);
    let parsed: { path?: unknown };
    try {
      parsed = JSON.parse(raw) as { path?: unknown };
    } catch {
      send(res, 400, "invalid json");
      return;
    }
    if (typeof parsed.path !== "string") {
      send(res, 400, "path required");
      return;
    }
    try {
      const result = await createSafeHtmlPreviewToken(workspaceRoot, parsed.path);
      if (!result.ok) {
        const status =
          result.reason === "not_found"
            ? 404
            : result.reason === "too_large"
              ? 413
              : 400;
        send(res, status, result.reason);
        return;
      }
      const openUrl = `http://127.0.0.1:${opts.port}/v1/files/safe-html?t=${encodeURIComponent(result.token)}`;
      sendJson(res, 200, { openUrl });
    } catch (err) {
      if (err instanceof WorkspaceEscapeError) {
        send(res, 400, err.message);
        return;
      }
      throw err;
    }
    return;
  }

  if (
    await handleSettingsRequest(req, res, {
      pathname,
      method: req.method ?? "GET",
      homeDir: opts.homeDir,
      workspaceRootRef: opts.workspaceRootRef,
      port: opts.port,
      busy: opts.busy,
      reloadRuntime: opts.reloadRuntime,
    })
  ) {
    return;
  }

  if (
    await handlePluginInstallRequest(req, res, {
      pathname,
      method: req.method ?? "GET",
      homeDir: opts.homeDir,
      workspaceRoot: workspaceRoot,
      busy: opts.busy,
      reloadRuntime: opts.reloadRuntime,
    })
  ) {
    return;
  }

  if (
    await handleKnowledgeRequest(req, res, {
      pathname,
      url,
      workspaceRoot,
      ctx: runtime.ctx,
    })
  ) {
    return;
  }

  if (
    await handleTurnGuard(req, res, {
      pathname,
      ctx: runtime.ctx,
      workspaceRoot,
      turns: opts.turns,
      busy: opts.busy,
      streamLoopResult: (sseReq, sseRes, session, work, turnId) =>
        streamLoopResult(
          sseReq,
          sseRes,
          session,
          opts.controllers,
          opts.turns,
          work,
          turnId,
        ),
      controllers: opts.controllers,
    })
  ) {
    return;
  }

  if (
    await handleTurnActions(req, res, {
      pathname,
      ctx: runtime.ctx,
      workspaceRoot,
      turns: opts.turns,
      busy: opts.busy,
      streamLoopResult: (sseReq, sseRes, session, work, turnId) =>
        streamLoopResult(
          sseReq,
          sseRes,
          session,
          opts.controllers,
          opts.turns,
          work,
          turnId,
        ),
      controllers: opts.controllers,
    })
  ) {
    return;
  }

  if (req.method === "GET" && pathname === "/v1/models") {
    sendJson(res, 200, runtime.ctx.require<ModelRegistry>("models").snapshot());
    return;
  }

  if (req.method === "POST" && pathname === "/v1/asr") {
    const bytes = await readBodyBytes(req, ASR_MAX_BYTES);
    if (bytes === "too_large") {
      send(res, 413);
      return;
    }
    if (bytes.length === 0) {
      send(res, 400);
      return;
    }
    const mimeRaw = req.headers["content-type"];
    const mimeType = typeof mimeRaw === "string" ? mimeRaw : "application/octet-stream";
    try {
      const text = await transcribeAudio(
        runtime.ctx,
        bytes,
        mimeType,
        new AbortController().signal,
      );
      sendJson(res, 200, { text });
    } catch (err) {
      if (err instanceof ModelKindMissingError) {
        sendJson(res, 503, { error: "unconfigured asr" });
        return;
      }
      send(res, 500);
    }
    return;
  }

  if (req.method === "POST" && pathname === "/v1/tts") {
    const raw = await readBody(req);
    let text: string | undefined;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        "text" in parsed &&
        typeof (parsed as { text: unknown }).text === "string"
      ) {
        text = (parsed as { text: string }).text;
      }
    } catch {
      text = undefined;
    }
    if (text === undefined || text.trim().length === 0) {
      send(res, 400);
      return;
    }
    try {
      const media = await synthesizeSpeech(
        runtime.ctx,
        text,
        new AbortController().signal,
      );
      res.statusCode = 200;
      res.setHeader("Content-Type", media.mimeType);
      res.end(Buffer.from(media.bytes));
    } catch (err) {
      if (err instanceof ModelKindMissingError) {
        sendJson(res, 503, { error: "unconfigured tts" });
        return;
      }
      send(res, 500);
    }
    return;
  }

  if (req.method === "GET" && pathname === "/v1/plugins") {
    sendJson(res, 200, runtime.plugins);
    return;
  }

  if (req.method === "GET" && pathname === "/v1/files/preview") {
    const rel = normalizeRelPath(url.searchParams.get("path"));
    if (rel === undefined) {
      send(res, 400);
      return;
    }
    try {
      const result = await previewWorkspaceFile(workspaceRoot, rel);
      if (result === "not_found") {
        send(res, 404);
        return;
      }
      sendJson(res, 200, result);
    } catch (err) {
      if (err instanceof WorkspaceEscapeError) {
        send(res, 400, err.message);
        return;
      }
      throw err;
    }
    return;
  }

  if (req.method === "GET" && pathname === "/v1/files/raw") {
    const rel = normalizeRelPath(url.searchParams.get("path"));
    if (rel === undefined) {
      send(res, 400);
      return;
    }
    try {
      const resolved = await resolveWorkspaceReadableFile(workspaceRoot, rel);
      if (resolved === "not_found") {
        send(res, 404);
        return;
      }
      if (resolved.size > rawFileMaxBytes(resolved.fileName)) {
        send(res, 413);
        return;
      }
      const contentType = contentTypeForFileName(resolved.fileName);
      const rangeHeader =
        typeof req.headers.range === "string" ? req.headers.range : undefined;
      const parsed = parseByteRangeHeader(rangeHeader, resolved.size);
      if (parsed.kind === "unsatisfiable") {
        res.writeHead(416, {
          "Content-Type": contentType,
          "Content-Range": `bytes */${resolved.size}`,
          "Accept-Ranges": "bytes",
        });
        res.end();
        return;
      }
      if (parsed.kind === "range") {
        const length = parsed.end - parsed.start + 1;
        res.writeHead(206, {
          "Content-Type": contentType,
          "Content-Length": length,
          "Accept-Ranges": "bytes",
          "Content-Range": `bytes ${parsed.start}-${parsed.end}/${resolved.size}`,
          "Cache-Control": "no-store",
        });
        createReadStream(resolved.absPath, {
          start: parsed.start,
          end: parsed.end,
        }).pipe(res);
        return;
      }
      res.writeHead(200, {
        "Content-Type": contentType,
        "Content-Length": resolved.size,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
      });
      createReadStream(resolved.absPath).pipe(res);
    } catch (err) {
      if (err instanceof WorkspaceEscapeError) {
        send(res, 400, err.message);
        return;
      }
      throw err;
    }
    return;
  }

  if (req.method === "PUT" && pathname === "/v1/files/raw") {
    const rel = normalizeRelPath(url.searchParams.get("path"));
    if (rel === undefined) {
      send(res, 400);
      return;
    }
    const bytes = await readBodyBytes(req, FILE_RAW_MAX_BYTES);
    if (bytes === "too_large") {
      send(res, 413);
      return;
    }
    try {
      const result = await writeWorkspaceFileBytes(workspaceRoot, rel, bytes);
      if (result === "not_found") {
        send(res, 404);
        return;
      }
      if (result === "too_large") {
        send(res, 413);
        return;
      }
      sendJson(res, 200, { ok: true });
    } catch (err) {
      if (err instanceof WorkspaceEscapeError) {
        send(res, 400, err.message);
        return;
      }
      throw err;
    }
    return;
  }

  if (req.method === "GET" && pathname === "/v1/files/markdown") {
    const rel = normalizeRelPath(url.searchParams.get("path"));
    if (rel === undefined) {
      send(res, 400);
      return;
    }
    try {
      const result = await readWorkspaceFileMarkdown(workspaceRoot, rel);
      if (result === "not_found") {
        send(res, 404);
        return;
      }
      if (result === "too_large") {
        send(res, 413);
        return;
      }
      if (result === "unsupported") {
        send(res, 400, "unsupported");
        return;
      }
      sendJson(res, 200, { path: rel, markdown: result });
    } catch (err) {
      if (err instanceof WorkspaceEscapeError) {
        send(res, 400, err.message);
        return;
      }
      throw err;
    }
    return;
  }

  if (req.method === "PUT" && pathname === "/v1/files/from-markdown") {
    const rel = normalizeRelPath(url.searchParams.get("path"));
    if (rel === undefined) {
      send(res, 400);
      return;
    }
    const raw = await readBody(req);
    let parsed: { markdown?: unknown };
    try {
      parsed = JSON.parse(raw) as { markdown?: unknown };
    } catch {
      send(res, 400, "invalid json");
      return;
    }
    if (typeof parsed.markdown !== "string") {
      send(res, 400, "markdown required");
      return;
    }
    try {
      const result = await writeWorkspaceFileFromMarkdown(
        workspaceRoot,
        rel,
        parsed.markdown,
      );
      if (result === "not_found") {
        send(res, 404);
        return;
      }
      if (result === "too_large") {
        send(res, 413);
        return;
      }
      if (result === "unsupported") {
        send(res, 400, "unsupported");
        return;
      }
      sendJson(res, 200, { ok: true });
    } catch (err) {
      if (err instanceof WorkspaceEscapeError) {
        send(res, 400, err.message);
        return;
      }
      if (err instanceof Error && err.message === "unreadable") {
        send(res, 400, "unreadable");
        return;
      }
      throw err;
    }
    return;
  }

  if (req.method === "POST" && pathname === "/v1/files/mkdir") {
    const body = await readJsonObject(req);
    if (body === "invalid") {
      send(res, 400, "invalid json");
      return;
    }
    const rel = normalizeRelPath(stringField(body, "path") ?? null);
    if (rel === undefined) {
      send(res, 400);
      return;
    }
    try {
      sendFileMutation(res, await createWorkspaceDirectory(workspaceRoot, rel));
    } catch (err) {
      if (err instanceof WorkspaceEscapeError) {
        send(res, 400, err.message);
        return;
      }
      throw err;
    }
    return;
  }

  if (req.method === "POST" && pathname === "/v1/files/create") {
    const body = await readJsonObject(req);
    if (body === "invalid") {
      send(res, 400, "invalid json");
      return;
    }
    const rel = normalizeRelPath(stringField(body, "path") ?? null);
    if (rel === undefined) {
      send(res, 400);
      return;
    }
    try {
      sendFileMutation(res, await createWorkspaceFile(workspaceRoot, rel));
    } catch (err) {
      if (err instanceof WorkspaceEscapeError) {
        send(res, 400, err.message);
        return;
      }
      throw err;
    }
    return;
  }

  if (req.method === "POST" && pathname === "/v1/files/rename") {
    const body = await readJsonObject(req);
    if (body === "invalid") {
      send(res, 400, "invalid json");
      return;
    }
    const fromRel = normalizeRelPath(stringField(body, "path") ?? null);
    const toRel = normalizeRelPath(stringField(body, "to") ?? null);
    if (fromRel === undefined || toRel === undefined) {
      send(res, 400);
      return;
    }
    try {
      sendFileMutation(
        res,
        await renameWorkspaceEntry(workspaceRoot, fromRel, toRel),
      );
    } catch (err) {
      if (err instanceof WorkspaceEscapeError) {
        send(res, 400, err.message);
        return;
      }
      throw err;
    }
    return;
  }

  if (req.method === "DELETE" && pathname === "/v1/files") {
    const rel = normalizeRelPath(url.searchParams.get("path"));
    if (rel === undefined) {
      send(res, 400);
      return;
    }
    try {
      sendFileMutation(res, await deleteWorkspaceEntry(workspaceRoot, rel));
    } catch (err) {
      if (err instanceof WorkspaceEscapeError) {
        send(res, 400, err.message);
        return;
      }
      throw err;
    }
    return;
  }

  if (req.method === "GET" && pathname === "/v1/files/sync") {
    const raw = url.searchParams.get("generation");
    if (raw === null || raw === "" || !/^[0-9]+$/.test(raw)) {
      send(res, 400);
      return;
    }
    const n = Number(raw);
    const ac = new AbortController();
    const onClose = () => {
      ac.abort();
    };
    req.on("close", onClose);
    res.on("close", onClose);
    try {
      const payload = await opts.fileWatch.wait(n, ac.signal);
      if (!res.destroyed && !res.writableEnded && !res.headersSent) {
        sendJson(res, 200, payload);
      }
    } catch {
      // client gone or workspace switched
    } finally {
      req.off("close", onClose);
      res.off("close", onClose);
    }
    return;
  }

  if (req.method === "GET" && pathname === "/v1/files") {
    const rel = normalizeRelPath(url.searchParams.get("path")) ?? ".";
    try {
      const result = await listWorkspaceFiles(workspaceRoot, rel);
      if (result === "hidden" || result === "not_found") {
        send(res, 404);
        return;
      }
      if (result === "not_directory") {
        send(res, 400, "failed: not a directory");
        return;
      }
      sendJson(res, 200, result);
    } catch (err) {
      if (err instanceof WorkspaceEscapeError) {
        send(res, 400, err.message);
        return;
      }
      throw err;
    }
    return;
  }

  const sessionMatch = /^\/v1\/sessions\/([^/]+)$/.exec(pathname);
  if (req.method === "GET" && sessionMatch) {
    const session = runtime.ctx
      .require<SessionStore>("sessions")
      .get(decodeURIComponent(sessionMatch[1]!));
    if (session === undefined) {
      send(res, 404);
      return;
    }
    sendJson(res, 200, { events: session.events() });
    return;
  }

  const cancelMatch = /^\/v1\/turns\/([^/]+)\/cancel$/.exec(pathname);
  if (req.method === "POST" && cancelMatch) {
    const turnId = decodeURIComponent(cancelMatch[1]!);
    const controller = opts.controllers.get(turnId);
    if (controller !== undefined) {
      controller.abort();
      send(res, 200);
      return;
    }
    const session = opts.turns.get(turnId);
    if (session === undefined) {
      send(res, 404);
      return;
    }
    cancelWaitingTurn(session, turnId);
    opts.turns.delete(turnId);
    send(res, 200);
    return;
  }

  if (req.method === "POST" && pathname === "/v1/turns") {
    const body = parseTurnBody(await readBody(req));
    if (body === undefined) {
      send(res, 400);
      return;
    }

    const session = runtime.ctx
      .require<SessionStore>("sessions")
      .getOrCreate(body.sessionId);

    if (sessionHasWaitingTurn(session) || opts.busy.has(session.id)) {
      send(res, 409);
      return;
    }
    opts.busy.add(session.id);
    try {
      await streamLoopResult(req, res, session, opts.controllers, opts.turns, ({ signal, onEvent }) =>
        runtime.ctx.require<LoopService>("loop").runTurn({
          ctx: runtime.ctx,
          session,
          text: body.text,
          images: body.images,
          webSearch: body.webSearch,
          workspaceRoot,
          channel: "host",
          signal,
          onEvent,
        }),
      );
    } finally {
      opts.busy.delete(session.id);
    }
    return;
  }

  if (req.method === "POST" && pathname === "/v1/hooks") {
    const raw = await readBody(req);
    const channels = runtime.ctx.get<ChannelRegistry>("channels");
    if (channels === undefined || !channels.has("webhook")) {
      send(res, 404);
      return;
    }
    const body = parseHookBody(raw);
    if (body === undefined) {
      send(res, 400);
      return;
    }

    const session = runtime.ctx
      .require<SessionStore>("sessions")
      .getOrCreate(body.sessionId);

    if (sessionHasWaitingTurn(session) || opts.busy.has(session.id)) {
      send(res, 409);
      return;
    }
    opts.busy.add(session.id);
    const controller = new AbortController();
    const onClose = () => {
      controller.abort();
    };
    req.on("close", onClose);
    res.on("close", onClose);
    try {
      const result = await channels.inbound("webhook", {
        text: body.text,
        sessionId: body.sessionId,
        workspaceRoot,
        signal: controller.signal,
      });
      req.off("close", onClose);
      res.off("close", onClose);
      if (!res.destroyed && !res.writableEnded && !res.headersSent) {
        sendJson(res, 200, {
          turnId: result.turnId,
          status: result.status,
          text: result.text,
        });
      }
    } finally {
      req.off("close", onClose);
      res.off("close", onClose);
      opts.busy.delete(session.id);
    }
    return;
  }

  send(res, 404);
}

export async function startHost(opts: {
  workspaceRoot: string;
  homeDir: string;
  port?: number;
}): Promise<{ url: string; close: () => Promise<void>; runtime: Runtime }> {
  const token = loadOrCreateToken(opts.homeDir);
  const workspaceRootRef = {
    current: resolveWorkspaceRoot(opts.homeDir, opts.workspaceRoot),
  };
  const runtimeRef = {
    current: await createRuntime(workspaceRootRef.current, opts.homeDir, {
      pollChannels: true,
    }),
  };
  const busyRef = {
    current: runtimeRef.current.ctx.require<Set<string>>("turnBusy"),
  };
  const controllers = new Map<string, AbortController>();
  const turns = new Map<string, Session>();
  let listenPort = opts.port ?? 7331;
  const fileWatch = createFileWatch({ root: workspaceRootRef.current });

  const reloadRuntime = async (): Promise<void> => {
    runtimeRef.current.stop();
    runtimeRef.current = await createRuntime(workspaceRootRef.current, opts.homeDir, {
      pollChannels: true,
    });
    busyRef.current = runtimeRef.current.ctx.require<Set<string>>("turnBusy");
    fileWatch.setRoot(workspaceRootRef.current);
  };

  const server = createServer((req, res) => {
    void handleRequest(req, res, {
      token,
      workspaceRootRef,
      homeDir: opts.homeDir,
      port: listenPort,
      runtimeRef,
      controllers,
      turns,
      busy: busyRef.current,
      reloadRuntime,
      fileWatch,
    }).catch((err: unknown) => {
      if (!res.destroyed && !res.writableEnded && !res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end(formatHostError(err, opts.homeDir, workspaceRootRef.current));
        return;
      }
      if (!res.destroyed && !res.writableEnded) {
        writeSse(res, { type: "end", status: "failed" });
        res.end();
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => {
      reject(err);
    };
    server.once("error", onError);
    server.listen({ host: "127.0.0.1", port: opts.port ?? 7331 }, () => {
      server.off("error", onError);
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected TCP listen address");
  }
  listenPort = address.port;

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        fileWatch.close();
        server.closeAllConnections();
        runtimeRef.current.stop();
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      }),
    runtime: runtimeRef.current,
  };
}
