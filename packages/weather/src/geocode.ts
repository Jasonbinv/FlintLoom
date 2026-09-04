import { getJson } from "./http.ts";
import type {
  GeoPlace,
  WeatherConfig,
  WeatherOutcome,
  WeatherSignals,
} from "./types.ts";

type GeocodingResult = {
  name?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  country?: unknown;
  admin1?: unknown;
  timezone?: unknown;
};

export async function geocodePlace(
  config: WeatherConfig,
  name: string,
  signals: WeatherSignals,
): Promise<WeatherOutcome<GeoPlace>> {
  const lang = /[\u3400-\u9fff]/.test(name) ? "zh" : "en";
  const url =
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}` +
    `&count=1&language=${lang}`;
  const outcome = await getJson(url, config.fetch ?? fetch, signals);
  if (!outcome.ok) {
    return outcome;
  }

  const body = outcome.value as { results?: unknown };
  const result = Array.isArray(body?.results)
    ? (body.results[0] as GeocodingResult | undefined)
    : undefined;
  if (!result) {
    return { ok: false, error: "failed: location not found" };
  }
  if (
    typeof result.name !== "string" ||
    typeof result.latitude !== "number" ||
    !Number.isFinite(result.latitude) ||
    typeof result.longitude !== "number" ||
    !Number.isFinite(result.longitude)
  ) {
    return { ok: false, error: "failed: weather" };
  }

  const place: GeoPlace = {
    name: result.name,
    latitude: result.latitude,
    longitude: result.longitude,
  };
  if (typeof result.country === "string") place.country = result.country;
  if (typeof result.admin1 === "string") place.admin1 = result.admin1;
  if (typeof result.timezone === "string") place.timezone = result.timezone;
  return { ok: true, value: place };
}
