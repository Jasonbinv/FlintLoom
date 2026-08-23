import type { WecomConfig } from "./config.ts";

const API_BASE = "https://qyapi.weixin.qq.com/cgi-bin";

type TokenCache = {
  token: string;
  expiresAt: number;
};

let tokenCache: TokenCache | undefined;

function isAbort(signal: AbortSignal, err: unknown): boolean {
  return signal.aborted || (err instanceof Error && err.name === "AbortError");
}

export function resetWecomTokenCache(): void {
  tokenCache = undefined;
}

export async function wecomAccessToken(
  parsed: WecomConfig,
  signal: AbortSignal,
): Promise<string> {
  const now = Date.now();
  if (tokenCache !== undefined && tokenCache.expiresAt > now + 60_000) {
    return tokenCache.token;
  }
  try {
    const url = `${API_BASE}/gettoken?corpid=${encodeURIComponent(parsed.corpId)}&corpsecret=${encodeURIComponent(parsed.corpSecret)}`;
    const res = await parsed.apiFetch(url, { method: "GET", signal });
    if (!res.ok) {
      throw new Error("gettoken");
    }
    const json = (await res.json()) as {
      errcode?: number;
      access_token?: string;
      expires_in?: number;
    };
    if (json.errcode !== 0 || typeof json.access_token !== "string") {
      throw new Error("gettoken");
    }
    const expireSec = typeof json.expires_in === "number" ? json.expires_in : 7200;
    tokenCache = {
      token: json.access_token,
      expiresAt: now + expireSec * 1000,
    };
    return tokenCache.token;
  } catch (err) {
    if (isAbort(signal, err)) {
      throw err;
    }
    throw new Error("gettoken");
  }
}

export async function wecomApi(
  parsed: WecomConfig,
  path: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const token = await wecomAccessToken(parsed, signal);
  try {
    const res = await parsed.apiFetch(`${API_BASE}${path}?access_token=${encodeURIComponent(token)}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      signal,
    });
    if (!res.ok) {
      throw new Error(path);
    }
    const json = (await res.json()) as Record<string, unknown>;
    if (json.errcode !== 0) {
      throw new Error(path);
    }
    return json;
  } catch (err) {
    if (isAbort(signal, err)) {
      throw err;
    }
    throw new Error(path);
  }
}
