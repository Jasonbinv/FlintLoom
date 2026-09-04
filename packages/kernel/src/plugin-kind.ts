import { WORKSPACE_ROOT_OVERLAY_PACKAGES } from "./plugin-overlay.ts";

export type PluginKind = "core" | "optional" | "channel" | "search" | "mcp";

const CORE_PLUGIN_IDS = new Set([
  "models",
  "tools",
  "session",
  "models-chat",
  "models-media",
  "models-guard",
  "loop",
  "fs",
  "grep",
  "shell",
]);

export function pluginKind(row: { id: string; name: string }): PluginKind {
  if (row.name === WORKSPACE_ROOT_OVERLAY_PACKAGES[0]) {
    return "mcp";
  }
  if (row.id === "channel" || row.id.startsWith("channel-")) {
    return "channel";
  }
  if (row.id === "web-search") {
    return "search";
  }
  if (CORE_PLUGIN_IDS.has(row.id)) {
    return "core";
  }
  return "optional";
}

export function isPluginToggleable(row: { id: string; name: string }): boolean {
  return pluginKind(row) === "optional";
}
