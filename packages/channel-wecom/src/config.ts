export type WecomConfig = {
  corpId: string;
  corpSecret: string;
  agentId: number;
  callbackToken: string;
  encodingAesKey: string | undefined;
  allowedUserIds: Set<string>;
  workspaceRoot: string;
  apiFetch: typeof fetch;
};

function userIdKey(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || !/^[\w@.-]+$/.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

export function parseWecomConfig(config: Record<string, unknown>): WecomConfig {
  const corpId =
    typeof config.corpId === "string"
      ? config.corpId
      : typeof config.appId === "string"
        ? config.appId
        : "";
  if (corpId.length === 0) {
    throw new Error("corpId");
  }
  const corpSecret =
    typeof config.corpSecret === "string"
      ? config.corpSecret
      : typeof config.token === "string"
        ? config.token
        : typeof config.appSecret === "string"
          ? config.appSecret
          : "";
  if (corpSecret.length === 0) {
    throw new Error("corpSecret");
  }
  const agentRaw = config.agentId;
  const agentId =
    typeof agentRaw === "number"
      ? agentRaw
      : typeof agentRaw === "string" && agentRaw.trim().length > 0
        ? Number(agentRaw.trim())
        : NaN;
  if (!Number.isSafeInteger(agentId) || agentId <= 0) {
    throw new Error("agentId");
  }
  const callbackToken =
    typeof config.callbackToken === "string" ? config.callbackToken.trim() : "";
  if (callbackToken.length === 0) {
    throw new Error("callbackToken");
  }
  const encodingAesKeyRaw =
    typeof config.encodingAesKey === "string" ? config.encodingAesKey.trim() : "";
  const encodingAesKey =
    encodingAesKeyRaw.length > 0 ? encodingAesKeyRaw : undefined;

  const rawIds = config.allowedUserIds ?? config.allowedChatIds;
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    throw new Error("allowedUserIds");
  }
  const allowedUserIds = new Set<string>();
  for (const item of rawIds) {
    const key = userIdKey(item);
    if (key === undefined) {
      throw new Error("allowedUserIds");
    }
    allowedUserIds.add(key);
  }
  const workspaceRoot =
    typeof config.workspaceRoot === "string" && config.workspaceRoot.length > 0
      ? config.workspaceRoot
      : undefined;
  if (workspaceRoot === undefined) {
    throw new Error("workspaceRoot");
  }
  const apiFetch =
    typeof config.apiFetch === "function"
      ? (config.apiFetch as typeof fetch)
      : globalThis.fetch;
  return {
    corpId,
    corpSecret,
    agentId,
    callbackToken,
    encodingAesKey,
    allowedUserIds,
    workspaceRoot,
    apiFetch,
  };
}
