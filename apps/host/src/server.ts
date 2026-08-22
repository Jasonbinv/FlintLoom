import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import type { ChannelRegistry } from "@flintloom/channel";
import { applyConfig, Context, loadConfig, mergeMcpServersIntoConfig } from "@flintloom/kernel";
import type { LoopService, RunTurnResult } from "@flintloom/loop";
import type { ModelRegistry } from "@flintloom/models";
import type { Session, SessionEvent, SessionStore } from "@flintloom/session";
import { WorkspaceEscapeError } from "@flintloom/tools";
import { cancelWaitingTurn, handleTurnActions, sessionHasWaitingTurn } from "./a2ui.ts";
import { handleTurnGuard } from "./guard.ts";
import {
  listWorkspaceFiles,
  normalizeRelPath,
  previewWorkspaceFile,
} from "./files.ts";
import { handleKnowledgeRequest } from "./knowledge.ts";
import { loadOrCreateToken, readCredentials } from "./token.ts";

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

function resolveChatApiKey(
  homeDir: string,
  fileEnv: Record<string, string>,
): string | undefined {
  const credKey = readCredentials(homeDir).chatApiKey;
  return firstNonEmpty(
    process.env.FLINTLOOM_API_KEY,
    fileEnv.FLINTLOOM_API_KEY,
    typeof credKey === "string" ? credKey : undefined,
  );
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
  const config = mergeMcpServersIntoConfig(
    loadConfig(readFileSync(ymlPath, "utf8")),
    { workspaceRoot, homeDir, fileEnv },
  );
  const apiKey = resolveChatApiKey(homeDir, fileEnv);
  const runtimeConfigById: Record<string, Record<string, unknown>> = {};
  if (apiKey !== undefined) {
    runtimeConfigById["models-chat"] = {
      apiKey,
      baseUrl:
        firstNonEmpty(process.env.FLINTLOOM_BASE_URL, fileEnv.FLINTLOOM_BASE_URL) ??
        "https://api.deepseek.com/v1",
      model:
        firstNonEmpty(
          process.env.FLINTLOOM_CHAT_MODEL,
          fileEnv.FLINTLOOM_CHAT_MODEL,
        ) ?? "deepseek-chat",
    };
  }
  runtimeConfigById.knowledge = {
    dbPath: join(homeDir, ".flintloom", "knowledge.sqlite"),
  };
  runtimeConfigById.skill = {
    homeDir,
  };

  if (opts?.pollChannels === true) {
    runtimeConfigById["channel-telegram"] = {
      workspaceRoot,
      poll: true,
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
  if (typeof credKey === "string" && credKey.length > 0) {
    secrets.push(credKey);
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

function parseTurnBody(raw: string): { sessionId: string; text: string } | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "sessionId" in parsed &&
      "text" in parsed &&
      typeof (parsed as { sessionId: unknown }).sessionId === "string" &&
      typeof (parsed as { text: unknown }).text === "string"
    ) {
      return {
        sessionId: (parsed as { sessionId: string }).sessionId,
        text: (parsed as { text: string }).text,
      };
    }
  } catch {
    // invalid JSON
  }
  return undefined;
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
    workspaceRoot: string;
    runtime: Runtime;
    controllers: Map<string, AbortController>;
    turns: Map<string, Session>;
    busy: Set<string>;
  },
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const pathname = url.pathname;

  if (pathname.startsWith("/v1/") && !isAuthorized(req, opts.token)) {
    send(res, 401);
    return;
  }

  if (
    await handleKnowledgeRequest(req, res, {
      pathname,
      url,
      workspaceRoot: opts.workspaceRoot,
      ctx: opts.runtime.ctx,
    })
  ) {
    return;
  }

  if (
    await handleTurnGuard(req, res, {
      pathname,
      ctx: opts.runtime.ctx,
      workspaceRoot: opts.workspaceRoot,
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
      ctx: opts.runtime.ctx,
      workspaceRoot: opts.workspaceRoot,
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
    sendJson(res, 200, opts.runtime.ctx.require<ModelRegistry>("models").snapshot());
    return;
  }

  if (req.method === "GET" && pathname === "/v1/plugins") {
    sendJson(res, 200, opts.runtime.plugins);
    return;
  }

  if (req.method === "GET" && pathname === "/v1/files/preview") {
    const rel = normalizeRelPath(url.searchParams.get("path"));
    if (rel === undefined) {
      send(res, 400);
      return;
    }
    try {
      const result = await previewWorkspaceFile(opts.workspaceRoot, rel);
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

  if (req.method === "GET" && pathname === "/v1/files") {
    const rel = normalizeRelPath(url.searchParams.get("path")) ?? ".";
    try {
      const result = await listWorkspaceFiles(opts.workspaceRoot, rel);
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
    const session = opts.runtime.ctx
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

    const session = opts.runtime.ctx
      .require<SessionStore>("sessions")
      .getOrCreate(body.sessionId);

    if (sessionHasWaitingTurn(session) || opts.busy.has(session.id)) {
      send(res, 409);
      return;
    }
    opts.busy.add(session.id);
    try {
      await streamLoopResult(req, res, session, opts.controllers, opts.turns, ({ signal, onEvent }) =>
        opts.runtime.ctx.require<LoopService>("loop").runTurn({
          ctx: opts.runtime.ctx,
          session,
          text: body.text,
          workspaceRoot: opts.workspaceRoot,
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
    const channels = opts.runtime.ctx.get<ChannelRegistry>("channels");
    if (channels === undefined || !channels.has("webhook")) {
      send(res, 404);
      return;
    }
    const body = parseHookBody(raw);
    if (body === undefined) {
      send(res, 400);
      return;
    }

    const session = opts.runtime.ctx
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
        workspaceRoot: opts.workspaceRoot,
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
  const runtime = await createRuntime(opts.workspaceRoot, opts.homeDir, {
    pollChannels: true,
  });
  const busy = runtime.ctx.require<Set<string>>("turnBusy");
  const controllers = new Map<string, AbortController>();
  const turns = new Map<string, Session>();

  const server = createServer((req, res) => {
    void handleRequest(req, res, {
      token,
      workspaceRoot: opts.workspaceRoot,
      runtime,
      controllers,
      turns,
      busy,
    }).catch((err: unknown) => {
      if (!res.destroyed && !res.writableEnded && !res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end(formatHostError(err, opts.homeDir, opts.workspaceRoot));
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

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        runtime.stop();
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      }),
    runtime,
  };
}
