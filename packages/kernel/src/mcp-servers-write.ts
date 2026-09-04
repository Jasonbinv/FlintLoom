import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isMap, isSeq, parseDocument, YAMLMap, YAMLSeq } from "yaml";
import { isPluginId } from "./plugin-entry.ts";
import {
  loadMcpServersFile,
  MCP_SERVERS_HOME_REL,
  MCP_SERVERS_WORKSPACE_FILE,
  type McpServerRow,
} from "./mcp-servers.ts";
import { replaceYmlAtomic } from "./yaml-atomic.ts";

export type McpServerDeclaration = McpServerRow & {
  enabled: boolean;
  source: "workspace" | "home";
  writable: boolean;
};

function workspacePath(workspaceRoot: string): string {
  return join(workspaceRoot, MCP_SERVERS_WORKSPACE_FILE);
}

function readServersOrEmpty(path: string): McpServerRow[] {
  if (!existsSync(path)) {
    return [];
  }
  return loadMcpServersFile(readFileSync(path, "utf8"));
}

function toDeclaration(
  server: McpServerRow,
  source: "workspace" | "home",
  writable: boolean,
): McpServerDeclaration {
  return {
    ...server,
    enabled: server.enabled !== false,
    source,
    writable,
  };
}

export function listMcpServerDeclarations(opts: {
  workspaceRoot: string;
  homeDir: string;
}): McpServerDeclaration[] {
  const homeServers = readServersOrEmpty(
    join(opts.homeDir, MCP_SERVERS_HOME_REL),
  );
  const workspaceServers = readServersOrEmpty(workspacePath(opts.workspaceRoot));
  const merged = new Map<string, McpServerDeclaration>();
  for (const server of homeServers) {
    merged.set(server.id, toDeclaration(server, "home", false));
  }
  for (const server of workspaceServers) {
    merged.set(server.id, toDeclaration(server, "workspace", true));
  }
  return [...merged.values()];
}

function rowToPlain(server: McpServerRow): Record<string, unknown> {
  const plain: Record<string, unknown> = {
    id: server.id,
    command: server.command,
  };
  if (server.args !== undefined) {
    plain.args = server.args;
  }
  if (server.env !== undefined) {
    plain.env = server.env;
  }
  if (server.enabled === false) {
    plain.enabled = false;
  }
  return plain;
}

function applyRowToMap(map: YAMLMap, server: McpServerRow): void {
  map.set("id", server.id);
  map.set("command", server.command);
  if (server.args !== undefined) {
    map.set("args", server.args);
  } else {
    map.delete("args");
  }
  if (server.env !== undefined) {
    map.set("env", server.env);
  } else {
    map.delete("env");
  }
  if (server.enabled === false) {
    map.set("enabled", false);
  } else {
    map.delete("enabled");
  }
}

function requireServersSeq(doc: ReturnType<typeof parseDocument>): YAMLSeq {
  const servers = doc.get("servers");
  if (!isSeq(servers)) {
    throw new Error("servers");
  }
  return servers;
}

function findServerIndex(servers: YAMLSeq, id: string): number {
  return servers.items.findIndex(
    (item) => isMap(item) && item.get("id") === id,
  );
}

function dumpAndReplace(
  path: string,
  doc: ReturnType<typeof parseDocument>,
): void {
  const dumped = String(doc);
  loadMcpServersFile(dumped);
  replaceYmlAtomic(path, dumped);
}

export function upsertWorkspaceMcpServer(
  workspaceRoot: string,
  server: McpServerRow,
): void {
  if (!isPluginId(server.id)) {
    throw new Error("id");
  }
  const path = workspacePath(workspaceRoot);
  const text = existsSync(path) ? readFileSync(path, "utf8") : "servers: []\n";
  const doc = parseDocument(text);
  const servers = requireServersSeq(doc);
  const idx = findServerIndex(servers, server.id);
  if (idx >= 0) {
    const item = servers.get(idx);
    if (isMap(item)) {
      applyRowToMap(item, server);
    } else {
      servers.set(idx, rowToPlain(server));
    }
  } else {
    servers.add(rowToPlain(server));
  }
  dumpAndReplace(path, doc);
}

function loadWorkspaceDoc(workspaceRoot: string): {
  path: string;
  doc: ReturnType<typeof parseDocument>;
  servers: YAMLSeq;
} {
  const path = workspacePath(workspaceRoot);
  if (!existsSync(path)) {
    throw new Error("home");
  }
  const doc = parseDocument(readFileSync(path, "utf8"));
  return { path, doc, servers: requireServersSeq(doc) };
}

export function deleteWorkspaceMcpServer(
  workspaceRoot: string,
  id: string,
): void {
  const { path, doc, servers } = loadWorkspaceDoc(workspaceRoot);
  const idx = findServerIndex(servers, id);
  if (idx < 0) {
    throw new Error("home");
  }
  servers.delete(idx);
  dumpAndReplace(path, doc);
}

export function setWorkspaceMcpEnabled(
  workspaceRoot: string,
  id: string,
  enabled: boolean,
): void {
  const { path, doc, servers } = loadWorkspaceDoc(workspaceRoot);
  const idx = findServerIndex(servers, id);
  if (idx < 0) {
    throw new Error("home");
  }
  const item = servers.get(idx);
  if (!isMap(item)) {
    throw new Error("id");
  }
  if (enabled) {
    item.delete("enabled");
  } else {
    item.set("enabled", false);
  }
  dumpAndReplace(path, doc);
}
