import { realpathSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { ingestWorkspaceFile } from "@flintloom/docforge";
import type { Context } from "@flintloom/kernel";
import { WorkspaceEscapeError } from "@flintloom/tools";
import { normalizeRelPath } from "./files.ts";

type KnowledgeRecord = {
  id: number;
  path: string;
  title: string;
  status: "ok" | "failed";
  ingestedAt: number;
  workspaceRoot: string;
  failReason?: string;
};

type KnowledgeHit = {
  id: number;
  path: string;
  title: string;
  snippet: string;
  workspaceRoot: string;
};

type KnowledgeService = {
  search(q: string): KnowledgeHit[];
  list(): KnowledgeRecord[];
};

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

function isCurrent(workspaceRoot: string, recordRoot: string): boolean {
  return recordRoot === realpathSync.native(workspaceRoot);
}

export function toPublicItem(row: KnowledgeRecord, workspaceRoot: string) {
  const { workspaceRoot: _workspaceRoot, ...rest } = row;
  return {
    ...rest,
    current: isCurrent(workspaceRoot, row.workspaceRoot),
  };
}

export function toPublicHit(hit: KnowledgeHit, workspaceRoot: string) {
  const { workspaceRoot: _workspaceRoot, ...rest } = hit;
  return {
    ...rest,
    current: isCurrent(workspaceRoot, hit.workspaceRoot),
  };
}

function parseImportPath(raw: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "path" in parsed &&
      typeof (parsed as { path: unknown }).path === "string"
    ) {
      return (parsed as { path: string }).path;
    }
  } catch {
    // invalid JSON
  }
  return undefined;
}

export async function handleKnowledgeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    pathname: string;
    url: URL;
    workspaceRoot: string;
    ctx: Context;
  },
): Promise<boolean> {
  const kb = opts.ctx.get<KnowledgeService>("knowledge");
  const isKnowledgeRoute =
    (req.method === "GET" && opts.pathname === "/v1/knowledge/search") ||
    (req.method === "GET" && opts.pathname === "/v1/knowledge") ||
    (req.method === "POST" && opts.pathname === "/v1/knowledge/import");

  if (!isKnowledgeRoute) {
    return false;
  }

  if (kb === undefined) {
    send(res, 404);
    return true;
  }

  if (req.method === "GET" && opts.pathname === "/v1/knowledge/search") {
    const q = opts.url.searchParams.get("q")?.trim() ?? "";
    if (q.length === 0 || q.length > 200) {
      send(res, 400);
      return true;
    }
    sendJson(res, 200, {
      hits: kb.search(q).map((hit) => toPublicHit(hit, opts.workspaceRoot)),
    });
    return true;
  }

  if (req.method === "GET" && opts.pathname === "/v1/knowledge") {
    sendJson(res, 200, {
      items: kb.list().map((row) => toPublicItem(row, opts.workspaceRoot)),
    });
    return true;
  }

  // POST /v1/knowledge/import
  const rawPath = parseImportPath(await readBody(req));
  const rel = normalizeRelPath(rawPath ?? null);
  if (rel === undefined) {
    send(res, 400);
    return true;
  }

  try {
    const outcome = await ingestWorkspaceFile(
      kb as Parameters<typeof ingestWorkspaceFile>[0],
      opts.workspaceRoot,
      rel,
    );
    switch (outcome.kind) {
      case "missing_path":
        send(res, 400);
        return true;
      case "hidden":
        sendJson(res, 200, {
          path: outcome.path,
          status: "failed",
          failReason: "hidden",
        });
        return true;
      case "not_found":
        send(res, 404);
        return true;
      case "not_a_file":
        send(res, 400, "failed: not a file");
        return true;
      case "aborted":
        send(res, 400);
        return true;
      case "written": {
        const { id, path, title, status, failReason } = outcome.record;
        const body: {
          id: number;
          path: string;
          title: string;
          status: string;
          failReason?: string;
        } = { id, path, title, status };
        if (failReason !== undefined) {
          body.failReason = failReason;
        }
        sendJson(res, 200, body);
        return true;
      }
      default:
        send(res, 500);
        return true;
    }
  } catch (err) {
    if (err instanceof WorkspaceEscapeError) {
      send(res, 400, err.message);
      return true;
    }
    throw err;
  }
}
