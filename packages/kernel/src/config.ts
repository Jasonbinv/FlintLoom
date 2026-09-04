import { parse } from "yaml";

export type FlintloomPluginRow = {
  id: string;
  name: string;
  config?: Record<string, unknown>;
  enabled?: boolean;
};

export type FlintloomConfig = {
  plugins: FlintloomPluginRow[];
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function loadConfig(text: string): FlintloomConfig {
  const root = parse(text);

  if (!isPlainObject(root)) {
    throw new Error("plugins");
  }

  if (!Array.isArray(root.plugins)) {
    throw new Error("plugins");
  }

  const plugins: FlintloomPluginRow[] = [];
  for (const row of root.plugins) {
    if (!isPlainObject(row)) {
      throw new Error("id");
    }

    if (!isNonEmptyString(row.id)) {
      throw new Error("id");
    }
    if (!isNonEmptyString(row.name)) {
      throw new Error("name");
    }

    const pluginRow: FlintloomPluginRow = {
      id: row.id,
      name: row.name,
    };

    if (row.config !== undefined) {
      if (!isPlainObject(row.config)) {
        throw new Error("config");
      }
      pluginRow.config = row.config;
    }

    if (row.enabled !== undefined) {
      if (typeof row.enabled !== "boolean") {
        throw new Error("enabled");
      }
      if (row.enabled === false) {
        pluginRow.enabled = false;
      }
    }

    plugins.push(pluginRow);
  }

  return { plugins };
}
