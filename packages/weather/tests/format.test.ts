import { describe, expect, it } from "vitest";
import { formatWeather } from "../src/format.ts";
import type { ForecastResult, GeoPlace } from "../src/types.ts";

const place: GeoPlace = {
  name: "Beijing",
  latitude: 39.9042,
  longitude: 116.4074,
  country: "China",
  admin1: "Beijing",
  timezone: "Asia/Shanghai",
};

const forecast: ForecastResult = {
  timezone: "Asia/Shanghai",
  current: {
    time: "2026-09-03T15:00",
    temperature: 22.4,
    humidity: 55.2,
    weatherCode: 2,
    windKmh: 12.4,
  },
  daily: [
    { date: "2026-09-03", min: 18.2, max: 28.1, weatherCode: 2, rainChance: 20 },
    { date: "2026-09-04", min: 17, max: 26, weatherCode: 61, rainChance: 60 },
    { date: "2026-09-05", min: 16, max: 25, weatherCode: 999 },
  ],
};

describe("formatWeather", () => {
  it("formats location, current, daily, and source", () => {
    const text = formatWeather(place, forecast);
    expect(text).toContain("Location: Beijing, China (39.90, 116.41)");
    expect(text).not.toMatch(/Location: Beijing, Beijing/);
    expect(text).toContain("Timezone: Asia/Shanghai");
    expect(text).toContain("Current (2026-09-03T15:00): 22°C, Partly cloudy, humidity 55%, wind 12 km/h");
    expect(text).toContain("Daily:\n");
    expect(text).toContain("2026-09-03  18/28°C  Partly cloudy  rain 20%");
    expect(text).toContain("2026-09-04  17/26°C  Slight rain  rain 60%");
    expect(text).toContain("2026-09-05  16/25°C  WMO 999");
    expect(text).not.toMatch(/2026-09-05.*rain/);
    expect(text).toMatch(/Source: Open-Meteo$/);
  });

  it("truncates output longer than 8000 characters", () => {
    const longName = "N".repeat(9000);
    const text = formatWeather(
      { ...place, name: longName, admin1: undefined },
      forecast,
    );
    expect(text.length).toBe(8000);
  });
});
