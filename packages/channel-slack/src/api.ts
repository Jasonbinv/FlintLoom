import type { SlackConfig } from "./config.ts";

const API_BASE = "https://slack.com/api";

function isAbort(signal: AbortSignal, err: unknown): boolean {
  return signal.aborted || (err instanceof Error && err.name === "AbortError");
}

export async function slackApi(
  parsed: SlackConfig,
  method: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  try {
    const res = await parsed.apiFetch(`${API_BASE}/${method}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${parsed.token}`,
        "Content-Type": "application/json; charset=utf-8",
        ...(init.headers ?? {}),
      },
      signal,
    });
    if (!res.ok) {
      throw new Error(method);
    }
    const json = (await res.json()) as Record<string, unknown>;
    if (json.ok !== true) {
      throw new Error(method);
    }
    return json;
  } catch (err) {
    if (isAbort(signal, err)) {
      throw err;
    }
    throw new Error(method);
  }
}
