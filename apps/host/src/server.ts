import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { createFsTool } from "@flintloom/fs";
import { createGrepTool } from "@flintloom/grep";
import { Context, loadConfig } from "@flintloom/kernel";
import { runTurn } from "@flintloom/loop";
import { ModelRegistry } from "@flintloom/models";
import { createOpenAiCompatChat } from "@flintloom/models-chat";
import { Session } from "@flintloom/session";
import { createShellTool } from "@flintloom/shell";
import { ToolRegistry } from "@flintloom/tools";
import { loadOrCreateToken, readCredentials } from "./token.ts";

export type Runtime = {
  ctx: Context;
  sessions: Map<string, Session>;
  models: ModelRegistry;
  tools: ToolRegistry;
};

function resolveChatApiKey(homeDir: string): string | undefined {
  const envKey = process.env.FLINTLOOM_API_KEY;
  if (typeof envKey === "string" && envKey.length > 0) {
    return envKey;
  }
  const credKey = readCredentials(homeDir).chatApiKey;
  if (typeof credKey === "string" && credKey.length > 0) {
    return credKey;
  }
  return undefined;
}

export function createRuntime(workspaceRoot: string, homeDir: string): Runtime {
  const ctx = new Context();
  const sessions = new Map<string, Session>();
  const models = new ModelRegistry();
  const tools = new ToolRegistry();

  tools.register(createFsTool());
  tools.register(createGrepTool());
  tools.register(createShellTool());

  try {
    loadConfig(readFileSync(join(workspaceRoot, "flintloom.yml"), "utf8"));
  } catch {
    // workspace may not include flintloom.yml; registration stays manual
  }

  const apiKey = resolveChatApiKey(homeDir);
  if (apiKey !== undefined) {
    models.registerChat(
      "default",
      createOpenAiCompatChat({
        baseUrl: process.env.FLINTLOOM_BASE_URL ?? "https://api.deepseek.com/v1",
        apiKey,
        model: process.env.FLINTLOOM_CHAT_MODEL ?? "deepseek-chat",
      }),
    );
    models.setDefault("chat", "default");
  }

  ctx.provide("sessions", sessions);
  ctx.provide("models", models);
  ctx.provide("tools", tools);

  return { ctx, sessions, models, tools };
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
  const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;

  if (pathname.startsWith("/v1/") && !isAuthorized(req, opts.token)) {
    send(res, 401);
    return;
  }

  if (req.method === "GET" && pathname === "/v1/models") {
    sendJson(res, 200, opts.runtime.models.snapshot());
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
    }).catch(() => {
      if (!res.headersSent) {
        send(res, 500);
      } else {
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
