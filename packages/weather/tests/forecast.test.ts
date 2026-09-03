import { describe, expect, it } from "vitest";
import { fetchForecast } from "../src/forecast.ts";
import type { GeoPlace, WeatherConfig } from "../src/types.ts";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function signals() {
  const user = new AbortController().signal;
  return { user, combined: user };
}

const place: GeoPlace = { name: "Beijing", latitude: 39.9, longitude: 116.4 };

const sample = {
  timezone: "Asia/Shanghai",
  current: {
    time: "2026-09-03T15:00",
    temperature_2m: 22.4,
    relative_humidity_2m: 55.2,
    weather_code: 2,
    wind_speed_10m: 12.4,
  },
  daily: {
    time: ["2026-09-03", "2026-09-04"],
    temperature_2m_max: [28.1, 26.0],
    temperature_2m_min: [18.2, 17.0],
    weather_code: [2, 61],
    precipitation_probability_max: [20, 60],
  },
};

describe("fetchForecast", () => {
  it("maps current and daily fields into the forecast URL", async () => {
    const seen: string[] = [];
    const config: WeatherConfig = {
      fetch: async (input) => {
        seen.push(String(input));
        return jsonResponse(200, sample);
      },
    };
    const out = await fetchForecast(config, place, 7, signals());
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.value.current.temperature).toBe(22.4);
      expect(out.value.daily).toHaveLength(2);
      expect(out.value.daily[1]?.rainChance).toBe(60);
    }
    expect(seen[0]).toContain("api.open-meteo.com/v1/forecast?");
    expect(seen[0]).toContain("latitude=39.9");
    expect(seen[0]).toContain("longitude=116.4");
    expect(seen[0]).toContain("timezone=auto");
    expect(seen[0]).toContain("forecast_days=7");
    expect(seen[0]).toContain("temperature_unit=celsius");
    expect(seen[0]).toContain("wind_speed_unit=kmh");
    expect(seen[0]).toContain("current=temperature_2m");
    expect(seen[0]).toContain("precipitation_probability_max");
  });

  it("limits daily rows to the requested days", async () => {
    const threeDaySample = {
      ...sample,
      daily: {
        time: ["2026-09-03", "2026-09-04", "2026-09-05"],
        temperature_2m_max: [28.1, 26.0, 25.2],
        temperature_2m_min: [18.2, 17.0, 16.4],
        weather_code: [2, 61, 3],
        precipitation_probability_max: [20, 60, 10],
      },
    };
    const out = await fetchForecast(
      { fetch: async () => jsonResponse(200, threeDaySample) },
      place,
      2,
      signals(),
    );

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.value.daily).toHaveLength(2);
      expect(out.value.daily.map((day) => day.date)).toEqual([
        "2026-09-03",
        "2026-09-04",
      ]);
    }
  });

  it("fails when current is missing", async () => {
    const out = await fetchForecast(
      { fetch: async () => jsonResponse(200, { daily: sample.daily }) },
      place,
      7,
      signals(),
    );
    expect(out).toEqual({ ok: false, error: "failed: weather" });
  });

  it("fails when a required current field is null", async () => {
    const out = await fetchForecast(
      {
        fetch: async () =>
          jsonResponse(200, {
            ...sample,
            current: { ...sample.current, temperature_2m: null },
          }),
      },
      place,
      7,
      signals(),
    );

    expect(out).toEqual({ ok: false, error: "failed: weather" });
  });

  it("fails when required daily arrays have different lengths", async () => {
    const out = await fetchForecast(
      {
        fetch: async () =>
          jsonResponse(200, {
            ...sample,
            daily: {
              ...sample.daily,
              temperature_2m_max: [28.1],
            },
          }),
      },
      place,
      7,
      signals(),
    );

    expect(out).toEqual({ ok: false, error: "failed: weather" });
  });
});
