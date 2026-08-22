import { isPluginId } from "@flintloom/kernel";

export type McpConfig = {
  id: string;
  command: string;
  args: string[];
  env: string[];
  envValues?: Record<string, string>;
  workspaceRoot: string;
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function validateMcpConfig(raw: Record<string, unknown>): McpConfig {
  const id = raw.id;
  if (typeof id !== "string" || !isPluginId(id)) {
    throw new Error("id");
  }

  const command = raw.command;
  if (typeof command !== "string" || command.length === 0) {
    throw new Error("command");
  }

  let args: string[] = [];
  if (raw.args !== undefined) {
    if (!isStringArray(raw.args)) {
      throw new Error("args");
    }
    args = raw.args;
  }

  let env: string[] = [];
  if (raw.env !== undefined) {
    if (!isStringArray(raw.env)) {
      throw new Error("env");
    }
    env = raw.env;
    for (const name of env) {
      const trimmed = name.trim();
      if (trimmed.length === 0 || trimmed.startsWith("FLINTLOOM_")) {
        throw new Error("env");
      }
    }
  }

  const workspaceRoot = raw.workspaceRoot;
  if (typeof workspaceRoot !== "string" || workspaceRoot.length === 0) {
    throw new Error("workspaceRoot");
  }

  let envValues: Record<string, string> | undefined;
  if (raw.envValues !== undefined) {
    if (raw.envValues === null || typeof raw.envValues !== "object") {
      throw new Error("envValues");
    }
    envValues = {};
    for (const [key, value] of Object.entries(
      raw.envValues as Record<string, unknown>,
    )) {
      if (typeof value !== "string") {
        throw new Error("envValues");
      }
      envValues[key] = value;
    }
  }

  return {
    id,
    command,
    args,
    env,
    envValues,
    workspaceRoot,
  };
}
