import type { FeishuConfig } from "./config.ts";

const API_BASE = "https://open.feishu.cn/open-apis";

type TokenCache = {
  token: string;
  expiresAt: number;
};

let tokenCache: TokenCache | undefined;

function isAbort(signal: AbortSignal, err: unknown): boolean {
  return signal.aborted || (err instanceof Error && err.name === "AbortError");
}

export function resetFeishuTokenCache(): void {
  tokenCache = undefined;
}

export async function feishuTenantToken(
  parsed: FeishuConfig,
  signal: AbortSignal,
): Promise<string> {
  const now = Date.now();
  if (tokenCache !== undefined && tokenCache.expiresAt > now + 60_000) {
    return tokenCache.token;
  }
  try {
    const res = await parsed.apiFetch(`${API_BASE}/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app_id: parsed.appId,
        app_secret: parsed.appSecret,
      }),
      signal,
    });
    if (!res.ok) {
      throw new Error("tenant_access_token");
    }
    const json = (await res.json()) as {
      code?: number;
      tenant_access_token?: string;
      expire?: number;
    };
    if (json.code !== 0 || typeof json.tenant_access_token !== "string") {
      throw new Error("tenant_access_token");
    }
    const expireSec = typeof json.expire === "number" ? json.expire : 7200;
    tokenCache = {
      token: json.tenant_access_token,
      expiresAt: now + expireSec * 1000,
    };
    return tokenCache.token;
  } catch (err) {
    if (isAbort(signal, err)) {
      throw err;
    }
    throw new Error("tenant_access_token");
  }
}

export async function feishuApi(
  parsed: FeishuConfig,
  path: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const token = await feishuTenantToken(parsed, signal);
  try {
    const res = await parsed.apiFetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      signal,
    });
    if (!res.ok) {
      throw new Error(path);
    }
    const json = (await res.json()) as Record<string, unknown>;
    if (json.code !== 0) {
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
