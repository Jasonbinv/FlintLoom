import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Bridge } from "../bridge.ts";
import { handleInboundWithSink } from "../bridge.ts";

export type HttpTransportOpts = {
  host: string;
  port: number;
  secret: string | undefined;
  bridge: Bridge;
};

type InboundBody = {
  from?: unknown;
  text?: unknown;
  room?: unknown;
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function unauthorized(res: ServerResponse): void {
  res.writeHead(401);
  res.end();
}

function badRequest(res: ServerResponse): void {
  res.writeHead(400);
  res.end();
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function parseInbound(raw: string): { from: string; text: string; room?: string } | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    const body = parsed as InboundBody;
    if (typeof body.from !== "string" || typeof body.text !== "string") {
      return undefined;
    }
    const text = body.text.trim();
    if (text.length === 0) {
      return undefined;
    }
    const room = typeof body.room === "string" && body.room.trim().length > 0
      ? body.room.trim()
      : undefined;
    return { from: body.from.trim(), text, room };
  } catch {
    return undefined;
  }
}

function checkAuth(req: IncomingMessage, secret: string | undefined): boolean {
  if (secret === undefined) {
    return true;
  }
  const header = req.headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) {
    return false;
  }
  return header.slice("Bearer ".length) === secret;
}

export function startHttpTransport(opts: HttpTransportOpts): Promise<{
  close: () => Promise<void>;
  url: string;
}> {
  const server = createServer((req, res) => {
    void handleRequest(req, res);
  });

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${opts.host}:${opts.port}`);
    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method !== "POST" || url.pathname !== "/v1/inbound") {
      res.writeHead(404);
      res.end();
      return;
    }
    if (!checkAuth(req, opts.secret)) {
      unauthorized(res);
      return;
    }
    const inbound = parseInbound(await readBody(req));
    if (inbound === undefined) {
      badRequest(res);
      return;
    }

    const collected: string[] = [];

    await handleInboundWithSink(
      opts.bridge,
      {
        async sendReply(_message, text) {
          collected.push(text);
        },
      },
      inbound,
    );

    sendJson(res, 200, {
      ok: true,
      reply: collected.join("\n"),
      parts: collected,
    });
  }

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, opts.host, () => {
      const addr = server.address();
      if (addr === null || typeof addr === "string") {
        reject(new Error("listen"));
        return;
      }
      const url = `http://${opts.host}:${addr.port}`;
      console.log(`[wechat-bridge] HTTP mode listening on ${url}/v1/inbound`);
      resolve({
        url,
        close: async () => {
          await new Promise<void>((done, closeErr) => {
            server.close((err) => (err ? closeErr(err) : done()));
          });
        },
      });
    });
  });
}
