import type { IncomingMessage, ServerResponse } from "node:http";
import { installPluginFromPath } from "@flintloom/kernel";

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

export async function handlePluginInstallRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    pathname: string;
    method: string;
    homeDir: string;
    workspaceRoot: string;
    busy: Set<string>;
    reloadRuntime: () => Promise<void>;
  },
): Promise<boolean> {
  if (opts.method !== "POST" || opts.pathname !== "/v1/plugins/install") {
    return false;
  }

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
    typeof (parsed as { sourcePath?: unknown }).sourcePath !== "string"
  ) {
    send(res, 400, "path");
    return true;
  }

  const body = parsed as { sourcePath: string; id?: unknown };
  const sourcePath = body.sourcePath.trim();
  if (sourcePath.length === 0) {
    send(res, 400, "path");
    return true;
  }

  const id =
    typeof body.id === "string" && body.id.trim().length > 0
      ? body.id.trim()
      : undefined;

  try {
    const result = await installPluginFromPath({
      workspaceRoot: opts.workspaceRoot,
      homeDir: opts.homeDir,
      sourcePath,
      id,
    });
    await opts.reloadRuntime();
    sendJson(res, 200, { ok: true, id: result.id, dest: result.dest });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "path" || message === "id" || message === "plugins") {
      send(res, 400, message);
      return true;
    }
    send(res, 500);
  }
  return true;
}
