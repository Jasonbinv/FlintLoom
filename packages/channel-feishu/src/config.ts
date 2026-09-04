export type FeishuConfig = {
  appId: string;
  appSecret: string;
  allowedChatIds: Set<string>;
  poll: boolean;
  workspaceRoot: string | undefined;
  apiFetch: typeof fetch;
};

function chatIdKey(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || !/^oc_[\w-]+$/.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

export function parseFeishuConfig(config: Record<string, unknown>): FeishuConfig {
  if (typeof config.appId !== "string" || config.appId.length === 0) {
    throw new Error("appId");
  }
  const appSecret =
    typeof config.appSecret === "string"
      ? config.appSecret
      : typeof config.token === "string"
        ? config.token
        : "";
  if (appSecret.length === 0) {
    throw new Error("appSecret");
  }
  const rawIds = config.allowedChatIds ?? config.allowedChannelIds;
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    throw new Error("allowedChatIds");
  }
  const allowedChatIds = new Set<string>();
  for (const item of rawIds) {
    const key = chatIdKey(item);
    if (key === undefined) {
      throw new Error("allowedChatIds");
    }
    allowedChatIds.add(key);
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
    appId: config.appId,
    appSecret,
    allowedChatIds,
    poll,
    workspaceRoot,
    apiFetch,
  };
}
