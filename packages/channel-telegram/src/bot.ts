import type { TelegramConfig } from "./config.ts";

function isAbort(signal: AbortSignal, err: unknown): boolean {
  return signal.aborted || (err instanceof Error && err.name === "AbortError");
}

export async function botPost(
  parsed: TelegramConfig,
  method: string,
  body: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  try {
    const res = await parsed.apiFetch(`https://api.telegram.org/bot${parsed.token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      throw new Error(method);
    }
    const json: unknown = await res.json();
    if (
      json === null ||
      typeof json !== "object" ||
      !("ok" in json) ||
      (json as { ok: unknown }).ok !== true
    ) {
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
