import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type BridgeMode = "http" | "wechaty";

export type BridgeConfig = {
  mode: BridgeMode;
  hookUrl: string;
  hostToken: string;
  allowedFrom: Set<string> | undefined;
  httpHost: string;
  httpPort: number;
  httpSecret: string | undefined;
  wechatyPuppet: string;
  wechatyToken: string | undefined;
};

function readHostTokenFromCredentials(homeDir: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(join(homeDir, ".flintloom", "credentials"), "utf8"),
    );
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      const token = (parsed as { hostToken?: unknown }).hostToken;
      if (typeof token === "string" && token.length > 0) {
        return token;
      }
    }
  } catch {
    // missing credentials
  }
  return undefined;
}

function parseAllowed(raw: string | undefined): Set<string> | undefined {
  if (raw === undefined || raw.trim().length === 0) {
    return undefined;
  }
  const items = raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (items.length === 0) {
    return undefined;
  }
  return new Set(items);
}

export function loadBridgeConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  const homeDir = env.HOME ?? env.USERPROFILE ?? homedir();
  const modeRaw = env.WECHAT_BRIDGE_MODE?.trim().toLowerCase();
  const mode: BridgeMode = modeRaw === "wechaty" ? "wechaty" : "http";

  const hookUrl =
    env.FLINTLOOM_HOOK_URL?.trim() || "http://127.0.0.1:7331/v1/hooks";
  const hostToken =
    env.FLINTLOOM_HOST_TOKEN?.trim() ||
    readHostTokenFromCredentials(homeDir) ||
    "";
  if (hostToken.length === 0) {
    throw new Error("missing FLINTLOOM_HOST_TOKEN and ~/.flintloom/credentials hostToken");
  }

  const httpPort = Number.parseInt(env.WECHAT_BRIDGE_PORT ?? "7340", 10);
  if (!Number.isFinite(httpPort) || httpPort <= 0) {
    throw new Error("invalid WECHAT_BRIDGE_PORT");
  }

  return {
    mode,
    hookUrl,
    hostToken,
    allowedFrom: parseAllowed(env.WECHAT_ALLOWED_FROM),
    httpHost: env.WECHAT_BRIDGE_HOST?.trim() || "127.0.0.1",
    httpPort,
    httpSecret: env.WECHAT_BRIDGE_SECRET?.trim() || undefined,
    wechatyPuppet: env.WECHATY_PUPPET?.trim() || "wechaty-puppet-wechat4u",
    wechatyToken: env.WECHATY_TOKEN?.trim() || undefined,
  };
}
