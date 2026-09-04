import { getJson } from "./http.ts";
import type {
  CurrentWeather,
  DailyWeather,
  ForecastResult,
  GeoPlace,
  WeatherConfig,
  WeatherOutcome,
  WeatherSignals,
} from "./types.ts";

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function mapForecast(value: unknown): WeatherOutcome<ForecastResult> {
  if (!isRecord(value) || !isRecord(value.current) || !isRecord(value.daily)) {
    return { ok: false, error: "failed: weather" };
  }

  const rawCurrent = value.current;
  if (
    !isFiniteNumber(rawCurrent.temperature_2m) ||
    !isFiniteNumber(rawCurrent.relative_humidity_2m) ||
    !isFiniteNumber(rawCurrent.weather_code) ||
    !isFiniteNumber(rawCurrent.wind_speed_10m)
  ) {
    return { ok: false, error: "failed: weather" };
  }

  const current: CurrentWeather = {
    temperature: rawCurrent.temperature_2m,
    humidity: rawCurrent.relative_humidity_2m,
    weatherCode: rawCurrent.weather_code,
    windKmh: rawCurrent.wind_speed_10m,
  };
  if (typeof rawCurrent.time === "string") {
    current.time = rawCurrent.time;
  }

  const rawDaily = value.daily;
  const dates = rawDaily.time;
  const maximums = rawDaily.temperature_2m_max;
  const minimums = rawDaily.temperature_2m_min;
  const weatherCodes = rawDaily.weather_code;
  const rainChances = rawDaily.precipitation_probability_max;
  if (
    !Array.isArray(dates) ||
    !Array.isArray(maximums) ||
    !Array.isArray(minimums) ||
    !Array.isArray(weatherCodes) ||
    maximums.length !== dates.length ||
    minimums.length !== dates.length ||
    weatherCodes.length !== dates.length
  ) {
    return { ok: false, error: "failed: weather" };
  }

  const daily: DailyWeather[] = [];
  for (let index = 0; index < dates.length; index += 1) {
    const date = dates[index];
    const min = minimums[index];
    const max = maximums[index];
    const weatherCode = weatherCodes[index];
    if (
      typeof date !== "string" ||
      !isFiniteNumber(min) ||
      !isFiniteNumber(max) ||
      !isFiniteNumber(weatherCode)
    ) {
      return { ok: false, error: "failed: weather" };
    }

    const day: DailyWeather = { date, min, max, weatherCode };
    const rainChance = Array.isArray(rainChances) ? rainChances[index] : undefined;
    if (isFiniteNumber(rainChance)) {
      day.rainChance = rainChance;
    }
    daily.push(day);
  }

  const forecast: ForecastResult = { current, daily };
  if (typeof value.timezone === "string") {
    forecast.timezone = value.timezone;
  }
  return { ok: true, value: forecast };
}

export async function fetchForecast(
  config: WeatherConfig,
  place: GeoPlace,
  days: number,
  signals: WeatherSignals,
): Promise<WeatherOutcome<ForecastResult>> {
  const params = new URLSearchParams({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    current:
      "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m",
    daily:
      "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    timezone: "auto",
    forecast_days: String(days),
    temperature_unit: "celsius",
    wind_speed_unit: "kmh",
  });
  const response = await getJson(
    `${FORECAST_URL}?${params.toString()}`,
    config.fetch ?? fetch,
    signals,
  );
  if (!response.ok) {
    return response;
  }

  const forecast = mapForecast(response.value);
  return forecast.ok
    ? {
        ok: true,
        value: { ...forecast.value, daily: forecast.value.daily.slice(0, days) },
      }
    : forecast;
}
