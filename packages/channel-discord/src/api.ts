import type { DiscordConfig } from "./config.ts";

const API_BASE = "https://discord.com/api/v10";

function isAbort(signal: AbortSignal, err: unknown): boolean {
  return signal.aborted || (err instanceof Error && err.name === "AbortError");
}

export async function discordApi(
  parsed: DiscordConfig,
  path: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<unknown> {
  try {
    const res = await parsed.apiFetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bot ${parsed.token}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      signal,
    });
    if (!res.ok) {
      throw new Error(path);
    }
    if (res.status === 204) {
      return undefined;
    }
    return res.json();
  } catch (err) {
    if (isAbort(signal, err)) {
      throw err;
    }
    throw new Error(path);
  }
}
