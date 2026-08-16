import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { createDocParseTool, createDocProbeTool } from "@flintloom/docforge";
import { createFsTool } from "@flintloom/fs";
import { createGrepTool } from "@flintloom/grep";
import { Context, loadConfig } from "@flintloom/kernel";
import { runTurn } from "@flintloom/loop";
import { ModelRegistry } from "@flintloom/models";
import { createOpenAiCompatChat } from "@flintloom/models-chat";
import { Session } from "@flintloom/session";
import { createShellTool } from "@flintloom/shell";
import { ToolRegistry, WorkspaceEscapeError } from "@flintloom/tools";
import {
  listWorkspaceFiles,
  normalizeRelPath,
  previewWorkspaceFile,
} from "./files.ts";
import { loadOrCreateToken, readCredentials } from "./token.ts";

export type Runtime = {
  ctx: Context;
  sessions: Map<string, Session>;
  models: ModelRegistry;
  tools: ToolRegistry;
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

export function createRuntime(workspaceRoot: string, homeDir: string): Runtime {
  const ctx = new Context();
  const sessions = new Map<string, Session>();
  const models = new ModelRegistry();
  const tools = new ToolRegistry();

  tools.register(createFsTool());
  tools.register(createGrepTool());
  tools.register(createShellTool());
  tools.register(createDocProbeTool());
  tools.register(createDocParseTool());

  const ymlPath = join(workspaceRoot, "flintloom.yml");
  if (existsSync(ymlPath)) {
    loadConfig(readFileSync(ymlPath, "utf8"));
  }

  const fileEnv = readDotEnv(join(workspaceRoot, ".env"));
  const apiKey = resolveChatApiKey(homeDir, fileEnv);
  if (apiKey !== undefined) {
    models.registerChat(
      "default",
      createOpenAiCompatChat({
        baseUrl:
          firstNonEmpty(process.env.FLINTLOOM_BASE_URL, fileEnv.FLINTLOOM_BASE_URL) ??
          "https://api.deepseek.com/v1",
        apiKey,
        model:
          firstNonEmpty(
            process.env.FLINTLOOM_CHAT_MODEL,
            fileEnv.FLINTLOOM_CHAT_MODEL,
          ) ?? "deepseek-chat",
      }),
    );
    models.setDefault("chat", "default");
  }

  ctx.provide("sessions", sessions);
  ctx.provide("models", models);
  ctx.provide("tools", tools);

  return { ctx, sessions, models, tools };
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
  },
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const pathname = url.pathname;

  if (pathname.startsWith("/v1/") && !isAuthorized(req, opts.token)) {
    send(res, 401);
    return;
  }

  if (req.method === "GET" && pathname === "/v1/models") {
    sendJson(res, 200, opts.runtime.models.snapshot());
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
    const session = opts.runtime.sessions.get(decodeURIComponent(sessionMatch[1]!));
    if (session === undefined) {
      send(res, 404);
      return;
    }
    sendJson(res, 200, { events: session.events() });
    return;
  }

  const cancelMatch = /^\/v1\/turns\/([^/]+)\/cancel$/.exec(pathname);
  if (req.method === "POST" && cancelMatch) {
    const controller = opts.controllers.get(decodeURIComponent(cancelMatch[1]!));
    if (controller === undefined) {
      send(res, 404);
      return;
    }
    controller.abort();
    send(res, 200);
    return;
  }

  if (req.method === "POST" && pathname === "/v1/turns") {
    const body = parseTurnBody(await readBody(req));
    if (body === undefined) {
      send(res, 400);
      return;
    }

    let session = opts.runtime.sessions.get(body.sessionId);
    if (session === undefined) {
      session = new Session(body.sessionId);
      opts.runtime.sessions.set(body.sessionId, session);
    }

    const controller = new AbortController();
    req.on("close", () => {
      controller.abort();
    });

    res.writeHead(200, { "Content-Type": "text/event-stream" });

    try {
      const result = await runTurn({
        session,
        text: body.text,
        models: opts.runtime.models,
        tools: opts.runtime.tools,
        workspaceRoot: opts.workspaceRoot,
        channel: "host",
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === "turn/start") {
            opts.controllers.set(event.turnId, controller);
          }
          writeSse(res, event);
        },
      });

      opts.controllers.set(result.turnId, controller);
      writeSse(res, { type: "end", status: result.status });
      res.end();
      opts.controllers.delete(result.turnId);
    } catch {
      writeSse(res, { type: "end", status: "failed" });
      res.end();
    }
    return;
  }

  send(res, 404);
}

export async function startHost(opts: {
  workspaceRoot: string;
  homeDir: string;
  port?: number;
}): Promise<{ url: string; close: () => Promise<void> }> {
  const token = loadOrCreateToken(opts.homeDir);
  const runtime = createRuntime(opts.workspaceRoot, opts.homeDir);
  const controllers = new Map<string, AbortController>();

  const server = createServer((req, res) => {
    void handleRequest(req, res, {
      token,
      workspaceRoot: opts.workspaceRoot,
      runtime,
      controllers,
    }).catch((err: unknown) => {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end(formatHostError(err, opts.homeDir, opts.workspaceRoot));
        return;
      }
      if (!res.writableEnded) {
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
        server.closeIdleConnections();
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      }),
  };
}
