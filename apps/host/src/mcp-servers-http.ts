import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import {
  MCP_SERVER_STATUS_KEY,
  deleteWorkspaceMcpServer,
  isPluginId,
  listMcpServerDeclarations,
  loadConfig,
  setWorkspaceMcpEnabled,
  upsertWorkspaceMcpServer,
  type Context,
  type McpServerDeclaration,
  type McpServerRuntimeStatus,
  type McpServerRow,
} from "@flintloom/kernel";

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

type McpServerSnapshot = {
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

type HandlerOpts = {
  pathname: string;
  method: string;
  homeDir: string;
  workspaceRoot: string;
  busy: Set<string>;
  reloadRuntime: () => Promise<void>;
  runtimeRef: { current: { ctx: Context } };
};

function itemId(pathname: string): string | undefined {
  const match = /^\/v1\/mcp-servers\/([^/]+)$/.exec(pathname);
  return match?.[1];
}

function copyId(pathname: string): string | undefined {
  const match = /^\/v1\/mcp-servers\/([^/]+)\/copy$/.exec(pathname);
  return match?.[1];
}

function sendKnownError(res: ServerResponse, err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  if (
    message === "id" ||
    message === "command" ||
    message === "args" ||
    message === "env" ||
    message === "home" ||
    message === "servers" ||
    message === "enabled"
  ) {
    send(res, 400, message);
    return true;
  }
  return false;
}

function flintloomPluginIds(workspaceRoot: string): Set<string> {
  const path = join(workspaceRoot, "flintloom.yml");
  if (!existsSync(path)) {
    return new Set();
  }
  return new Set(loadConfig(readFileSync(path, "utf8")).plugins.map((row) => row.id));
}

function toSnapshot(
  decl: McpServerDeclaration,
  table: Map<string, McpServerRuntimeStatus> | undefined,
): McpServerSnapshot {
  const base = {
    id: decl.id,
    command: decl.command,
    args: decl.args ?? [],
    env: decl.env ?? [],
    enabled: decl.enabled !== false,
    source: decl.source,
    writable: decl.writable,
  };
  if (decl.enabled === false) {
    return { ...base, enabled: false, status: "disabled", tools: [], error: null };
  }
  const row = table?.get(decl.id);
  if (row === undefined) {
    return { ...base, status: "loaded", tools: [], error: null };
  }
  if (row.status === "error") {
    return {
      ...base,
      status: "error",
      tools: row.tools,
      error: row.error ?? "error",
    };
  }
  return { ...base, status: "loaded", tools: row.tools, error: null };
}

function listSnapshots(opts: HandlerOpts): McpServerSnapshot[] {
  const table = opts.runtimeRef.current.ctx.get<Map<string, McpServerRuntimeStatus>>(
    MCP_SERVER_STATUS_KEY,
  );
  return listMcpServerDeclarations({
    workspaceRoot: opts.workspaceRoot,
    homeDir: opts.homeDir,
  }).map((decl) => toSnapshot(decl, table));
}

function snapshotById(opts: HandlerOpts, id: string): McpServerSnapshot | undefined {
  return listSnapshots(opts).find((server) => server.id === id);
}

async function parseJson(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<unknown | undefined> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readBody(req));
  } catch {
    send(res, 400);
    return undefined;
  }
  return parsed;
}

function readStringArrayField(
  value: unknown,
  field: "args" | "env",
): { ok: true; value?: string[] } | { ok: false } {
  if (value === undefined) {
    return { ok: true };
  }
  if (!isStringArray(value)) {
    return { ok: false };
  }
  if (field === "env") {
    for (const name of value) {
      const trimmed = name.trim();
      if (trimmed.length === 0 || trimmed.startsWith("FLINTLOOM_")) {
        return { ok: false };
      }
    }
  }
  return { ok: true, value };
}

async function afterWrite(
  res: ServerResponse,
  opts: HandlerOpts,
  onOk: () => void,
): Promise<void> {
  if (opts.busy.size > 0) {
    sendJson(res, 409, { error: "busy", written: true });
    return;
  }
  await opts.reloadRuntime();
  onOk();
}

function writeRow(workspaceRoot: string, row: McpServerRow, res: ServerResponse): boolean {
  try {
    upsertWorkspaceMcpServer(workspaceRoot, row);
    return true;
  } catch (err) {
    if (sendKnownError(res, err)) {
      return false;
    }
    throw err;
  }
}

export async function handleMcpServersRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: HandlerOpts,
): Promise<boolean> {
  if (opts.method === "GET" && opts.pathname === "/v1/mcp-servers") {
    sendJson(res, 200, { servers: listSnapshots(opts) });
    return true;
  }

  if (opts.method === "POST" && opts.pathname === "/v1/mcp-servers") {
    const parsed = await parseJson(req, res);
    if (parsed === undefined) {
      return true;
    }
    if (!isPlainObject(parsed)) {
      send(res, 400);
      return true;
    }
    if (typeof parsed.id !== "string" || !isPluginId(parsed.id)) {
      send(res, 400, "id");
      return true;
    }
    if (typeof parsed.command !== "string" || parsed.command.length === 0) {
      send(res, 400, "command");
      return true;
    }
    const args = readStringArrayField(parsed.args, "args");
    if (!args.ok) {
      send(res, 400, "args");
      return true;
    }
    const env = readStringArrayField(parsed.env, "env");
    if (!env.ok) {
      send(res, 400, "env");
      return true;
    }
    const id = parsed.id;
    if (flintloomPluginIds(opts.workspaceRoot).has(id)) {
      send(res, 400, "id");
      return true;
    }
    const existing = listMcpServerDeclarations({
      workspaceRoot: opts.workspaceRoot,
      homeDir: opts.homeDir,
    });
    if (existing.some((server) => server.id === id)) {
      send(res, 400, "id");
      return true;
    }
    const row: McpServerRow = { id, command: parsed.command };
    if (args.value !== undefined) {
      row.args = args.value;
    }
    if (env.value !== undefined) {
      row.env = env.value;
    }
    if (!writeRow(opts.workspaceRoot, row, res)) {
      return true;
    }
    await afterWrite(res, opts, () => {
      const server = snapshotById(opts, id);
      if (server === undefined) {
        send(res, 500);
        return;
      }
      sendJson(res, 200, { ok: true, server });
    });
    return true;
  }

  const copiedId = copyId(opts.pathname);
  if (opts.method === "POST" && copiedId !== undefined) {
    if (!isPluginId(copiedId)) {
      send(res, 400, "id");
      return true;
    }
    const listed = listMcpServerDeclarations({
      workspaceRoot: opts.workspaceRoot,
      homeDir: opts.homeDir,
    });
    const found = listed.find((server) => server.id === copiedId);
    if (found === undefined || found.writable) {
      send(res, 400, "id");
      return true;
    }
    if (found.source !== "home") {
      send(res, 400, "home");
      return true;
    }
    const row: McpServerRow = { id: found.id, command: found.command };
    if (found.args !== undefined) {
      row.args = found.args;
    }
    if (found.env !== undefined) {
      row.env = found.env;
    }
    if (found.enabled === false) {
      row.enabled = false;
    }
    if (!writeRow(opts.workspaceRoot, row, res)) {
      return true;
    }
    await afterWrite(res, opts, () => {
      const server = snapshotById(opts, copiedId);
      if (server === undefined) {
        send(res, 500);
        return;
      }
      sendJson(res, 200, { ok: true, server });
    });
    return true;
  }

  const id = itemId(opts.pathname);
  if (id === undefined) {
    return false;
  }
  if (!isPluginId(id)) {
    send(res, 400, "id");
    return true;
  }

  if (opts.method === "PUT") {
    const parsed = await parseJson(req, res);
    if (parsed === undefined) {
      return true;
    }
    if (!isPlainObject(parsed) || "enabled" in parsed) {
      send(res, 400);
      return true;
    }
    if (typeof parsed.command !== "string" || parsed.command.length === 0) {
      send(res, 400, "command");
      return true;
    }
    const args = readStringArrayField(parsed.args, "args");
    if (!args.ok) {
      send(res, 400, "args");
      return true;
    }
    const env = readStringArrayField(parsed.env, "env");
    if (!env.ok) {
      send(res, 400, "env");
      return true;
    }
    const listed = listMcpServerDeclarations({
      workspaceRoot: opts.workspaceRoot,
      homeDir: opts.homeDir,
    });
    const found = listed.find((server) => server.id === id);
    if (found === undefined || !found.writable) {
      send(res, 400, "home");
      return true;
    }
    const row: McpServerRow = { id, command: parsed.command };
    if (args.value !== undefined) {
      row.args = args.value;
    } else if (found.args !== undefined) {
      row.args = found.args;
    }
    if (env.value !== undefined) {
      row.env = env.value;
    } else if (found.env !== undefined) {
      row.env = found.env;
    }
    if (found.enabled === false) {
      row.enabled = false;
    }
    if (!writeRow(opts.workspaceRoot, row, res)) {
      return true;
    }
    await afterWrite(res, opts, () => {
      const server = snapshotById(opts, id);
      if (server === undefined) {
        send(res, 500);
        return;
      }
      sendJson(res, 200, { ok: true, server });
    });
    return true;
  }

  if (opts.method === "PATCH") {
    const parsed = await parseJson(req, res);
    if (parsed === undefined) {
      return true;
    }
    if (
      !isPlainObject(parsed) ||
      Object.keys(parsed).length !== 1 ||
      typeof parsed.enabled !== "boolean"
    ) {
      send(res, 400);
      return true;
    }
    try {
      setWorkspaceMcpEnabled(opts.workspaceRoot, id, parsed.enabled);
    } catch (err) {
      if (sendKnownError(res, err)) {
        return true;
      }
      throw err;
    }
    await afterWrite(res, opts, () => {
      const server = snapshotById(opts, id);
      if (server === undefined) {
        send(res, 500);
        return;
      }
      sendJson(res, 200, { ok: true, server });
    });
    return true;
  }

  if (opts.method === "DELETE") {
    try {
      deleteWorkspaceMcpServer(opts.workspaceRoot, id);
    } catch (err) {
      if (sendKnownError(res, err)) {
        return true;
      }
      throw err;
    }
    await afterWrite(res, opts, () => {
      sendJson(res, 200, { ok: true, id });
    });
    return true;
  }

  return false;
}
