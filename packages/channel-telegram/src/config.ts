export type TelegramConfig = {
  token: string;
  allowedChatIds: Set<string>;
  poll: boolean;
  workspaceRoot: string | undefined;
  apiFetch: typeof fetch;
};

function chatIdKey(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return String(value);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    const n = Number(value);
    if (Number.isSafeInteger(n)) {
      return String(n);
    }
  }
  return undefined;
}

export function parseTelegramConfig(config: Record<string, unknown>): TelegramConfig {
  if (typeof config.token !== "string" || config.token.length === 0) {
    throw new Error("token");
  }
  if (!Array.isArray(config.allowedChatIds) || config.allowedChatIds.length === 0) {
    throw new Error("allowedChatIds");
  }
  const allowedChatIds = new Set<string>();
  for (const item of config.allowedChatIds) {
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
    token: config.token,
    allowedChatIds,
    poll,
    workspaceRoot,
    apiFetch,
  };
}
