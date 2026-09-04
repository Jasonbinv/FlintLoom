import { describe, expect, it } from "vitest";
import { geocodePlace } from "../src/geocode.ts";
import type { WeatherConfig } from "../src/types.ts";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function signals(): { user: AbortSignal; combined: AbortSignal } {
  const user = new AbortController().signal;
  return { user, combined: user };
}

describe("geocodePlace", () => {
  it("uses language=zh and encodes CJK names", async () => {
    const seen: string[] = [];
    const config: WeatherConfig = {
      fetch: async (input, init) => {
        seen.push(String(input));
        expect(init?.headers).toMatchObject({ "User-Agent": "FlintLoom/get_weather" });
        return jsonResponse(200, {
          results: [
            {
              name: "Beijing",
              latitude: 39.9042,
              longitude: 116.4074,
              country: "China",
              admin1: "Beijing",
              timezone: "Asia/Shanghai",
            },
          ],
        });
      },
    };
    const out = await geocodePlace(config, "北京", signals());
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.value.name).toBe("Beijing");
      expect(out.value.latitude).toBe(39.9042);
    }
    expect(seen[0]).toContain("geocoding-api.open-meteo.com/v1/search?");
    expect(seen[0]).toContain("language=zh");
    expect(seen[0]).toContain(`name=${encodeURIComponent("北京")}`);
    expect(seen[0]).toContain("count=1");
  });

  it("uses language=en for Latin names", async () => {
    const seen: string[] = [];
    await geocodePlace(
      {
        fetch: async (input) => {
          seen.push(String(input));
          return jsonResponse(200, {
            results: [{ name: "Berlin", latitude: 52.52, longitude: 13.41 }],
          });
        },
      },
      "Berlin",
      signals(),
    );
    expect(seen[0]).toContain("language=en");
    expect(seen[0]).not.toContain("language=zh");
  });

  it("returns location not found when results missing or empty", async () => {
    const empty = await geocodePlace(
      { fetch: async () => jsonResponse(200, {}) },
      "Nowhere",
      signals(),
    );
    expect(empty).toEqual({ ok: false, error: "failed: location not found" });
    const none = await geocodePlace(
      { fetch: async () => jsonResponse(200, { results: [] }) },
      "Nowhere",
      signals(),
    );
    expect(none).toEqual({ ok: false, error: "failed: location not found" });
  });

  it("maps HTTP errors", async () => {
    const out = await geocodePlace(
      { fetch: async () => jsonResponse(403, { error: true }) },
      "Berlin",
      signals(),
    );
    expect(out).toEqual({ ok: false, error: "failed: weather 403" });
  });
});
