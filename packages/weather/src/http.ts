import type { WeatherOutcome, WeatherSignals } from "./types.ts";

export async function getJson(
  url: string,
  fetchFn: typeof fetch,
  signals: WeatherSignals,
): Promise<WeatherOutcome<unknown>> {
  try {
    const response = await fetchFn(url, {
      signal: signals.combined,
      headers: { "User-Agent": "FlintLoom/get_weather" },
    });

    if (!response.ok) {
      return { ok: false, error: `failed: weather ${response.status}` };
    }

    try {
      return { ok: true, value: await response.json() };
    } catch {
      return { ok: false, error: "failed: weather" };
    }
  } catch (error) {
    if (signals.user.aborted) {
      return { ok: false, error: "aborted" };
    }
    if (
      (error instanceof DOMException && error.name === "TimeoutError") ||
      (signals.combined.aborted && !signals.user.aborted)
    ) {
      return { ok: false, error: "failed: timeout" };
    }
    return { ok: false, error: "failed: weather" };
  }
}
