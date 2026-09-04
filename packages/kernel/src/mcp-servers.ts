import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import type { FlintloomConfig, FlintloomPluginRow } from "./config.ts";
import { isPluginId } from "./plugin-entry.ts";
import { WORKSPACE_ROOT_OVERLAY_PACKAGES } from "./plugin-overlay.ts";

export const MCP_SERVERS_WORKSPACE_FILE = "mcp-servers.yml";
export const MCP_SERVERS_HOME_REL = ".flintloom/mcp-servers.yml";

const MCP_PLUGIN_NAME = WORKSPACE_ROOT_OVERLAY_PACKAGES[0];

export type McpServerRow = {
  id: string;
  command: string;
  args?: string[];
  env?: string[];
  enabled?: boolean;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function loadMcpServersFile(text: string): McpServerRow[] {
  const root = parse(text);
  if (!isPlainObject(root) || !Array.isArray(root.servers)) {
    throw new Error("servers");
  }

  const servers: McpServerRow[] = [];
  for (const row of root.servers) {
    if (!isPlainObject(row)) {
      throw new Error("id");
    }
    const id = row.id;
    if (typeof id !== "string" || !isPluginId(id)) {
      throw new Error("id");
    }
    const command = row.command;
    if (typeof command !== "string" || command.length === 0) {
      throw new Error("command");
    }

    let args: string[] | undefined;
    if (row.args !== undefined) {
      if (!isStringArray(row.args)) {
        throw new Error("args");
      }
      args = row.args;
    }

    let env: string[] | undefined;
    if (row.env !== undefined) {
      if (!isStringArray(row.env)) {
        throw new Error("env");
      }
      for (const name of row.env) {
        const trimmed = name.trim();
        if (trimmed.length === 0 || trimmed.startsWith("FLINTLOOM_")) {
          throw new Error("env");
        }
      }
      env = row.env;
    }

    const serverRow: McpServerRow = {
      id,
      command,
      args,
      env,
    };

    if (row.enabled !== undefined) {
      if (typeof row.enabled !== "boolean") {
        throw new Error("enabled");
      }
      if (row.enabled === false) {
        serverRow.enabled = false;
      }
    }

    servers.push(serverRow);
  }

  return servers;
}

function readMcpServersFromPath(path: string): McpServerRow[] {
  if (!existsSync(path)) {
    return [];
  }
  return loadMcpServersFile(readFileSync(path, "utf8"));
}

function resolveMcpEnvValues(
  env: string[] | undefined,
  fileEnv: Record<string, string>,
): Record<string, string> | undefined {
  if (env === undefined || env.length === 0) {
    return undefined;
  }
  const envValues: Record<string, string> = {};
  for (const rawName of env) {
    const name = rawName.trim();
    const fromFile = fileEnv[name];
    if (typeof fromFile === "string" && fromFile.length > 0) {
      envValues[name] = fromFile;
    }
  }
  return Object.keys(envValues).length > 0 ? envValues : undefined;
}

function toPluginRow(
  server: McpServerRow,
  fileEnv: Record<string, string>,
): FlintloomPluginRow {
  const config: Record<string, unknown> = {
    command: server.command,
  };
  if (server.args !== undefined) {
    config.args = server.args;
  }
  if (server.env !== undefined) {
    config.env = server.env;
  }
  const envValues = resolveMcpEnvValues(server.env, fileEnv);
  if (envValues !== undefined) {
    config.envValues = envValues;
  }
  return {
    id: server.id,
    name: MCP_PLUGIN_NAME,
    config,
  };
}

/**
 * Merge MCP servers from home + workspace `mcp-servers.yml` into assembly config.
 * Workspace entries override home by `id`. Skips ids already present in `flintloom.yml`.
 */
export function mergeMcpServersIntoConfig(
  config: FlintloomConfig,
  opts: {
    workspaceRoot: string;
    homeDir: string;
    fileEnv?: Record<string, string>;
  },
): FlintloomConfig {
  const fileEnv = opts.fileEnv ?? {};
  const homeServers = readMcpServersFromPath(
    join(opts.homeDir, MCP_SERVERS_HOME_REL),
  );
  const workspaceServers = readMcpServersFromPath(
    join(opts.workspaceRoot, MCP_SERVERS_WORKSPACE_FILE),
  );

  const merged = new Map<string, McpServerRow>();
  for (const server of homeServers) {
    merged.set(server.id, server);
  }
  for (const server of workspaceServers) {
    merged.set(server.id, server);
  }

  if (merged.size === 0) {
    return config;
  }

  const existingIds = new Set(config.plugins.map((row) => row.id));
  const plugins = [...config.plugins];
  for (const server of merged.values()) {
    if (existingIds.has(server.id)) {
      continue;
    }
    if (server.enabled === false) {
      continue;
    }
    plugins.push(toPluginRow(server, fileEnv));
    existingIds.add(server.id);
  }

  return { plugins };
}

export const MCP_SERVER_STATUS_KEY = "mcp-server-status";

export type McpServerRuntimeStatus = {
  status: "loaded" | "error";
  error?: string;
  tools: string[];
};
