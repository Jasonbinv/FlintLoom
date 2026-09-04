export type SlackConfig = {
  token: string;
  allowedChannelIds: Set<string>;
  poll: boolean;
  workspaceRoot: string | undefined;
  apiFetch: typeof fetch;
};

function channelIdKey(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || !/^[CG][A-Z0-9]+$/.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

export function parseSlackConfig(config: Record<string, unknown>): SlackConfig {
  if (typeof config.token !== "string" || config.token.length === 0) {
    throw new Error("token");
  }
  const rawIds = config.allowedChannelIds ?? config.allowedChatIds;
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    throw new Error("allowedChannelIds");
  }
  const allowedChannelIds = new Set<string>();
  for (const item of rawIds) {
    const key = channelIdKey(item);
    if (key === undefined) {
      throw new Error("allowedChannelIds");
    }
    allowedChannelIds.add(key);
  }
  const poll = config.poll === true;
  const workspaceRoot =
    typeof config.workspaceRoot === "string" && config.workspaceRoot.length > 0
      ? config.workspaceRoot
      : undefined;
  if (poll && workspaceRoot === undefined) {
    throw new Error("workspaceRoot");
  }
  const apiFetch =
    typeof config.apiFetch === "function"
      ? (config.apiFetch as typeof fetch)
      : globalThis.fetch;
  return {
    token: config.token,
    allowedChannelIds,
    poll,
    workspaceRoot,
    apiFetch,
  };
}
