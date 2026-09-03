import type { ToolDefinition } from "@flintloom/tools";
import { fetchForecast } from "./forecast.ts";
import { formatWeather } from "./format.ts";
import { geocodePlace } from "./geocode.ts";
import type { WeatherConfig } from "./types.ts";

export function createGetWeatherTool(
  config: WeatherConfig = {},
): ToolDefinition {
  const fetchFn = config.fetch ?? globalThis.fetch;
  const weatherConfig: WeatherConfig = { fetch: fetchFn };

  return {
    name: "get_weather",
    description:
      "Get current weather and a daily forecast for a named place. Prefer this over web_search for temperature, conditions, wind, humidity, or rain chance. Not for historical climate.",
    parameters: {
      type: "object",
      properties: {
        location: { type: "string", minLength: 2, maxLength: 200 },
        days: { type: "integer", minimum: 1, maximum: 7 },
      },
      required: ["location"],
    },
    async execute(args, exec) {
      if (
        typeof args.location !== "string" ||
        args.location.trim().length < 2
      ) {
        return "failed: empty location";
      }

      const location = args.location.trim().slice(0, 200);
      const days =
        Number.isInteger(args.days) &&
        (args.days as number) >= 1 &&
        (args.days as number) <= 7
          ? (args.days as number)
          : 7;
      const combined = AbortSignal.any([
        exec.signal,
        AbortSignal.timeout(12_000),
      ]);
      const signals = { user: exec.signal, combined };

      const place = await geocodePlace(weatherConfig, location, signals);
      if (!place.ok) {
        return place.error;
      }

      const forecast = await fetchForecast(
        weatherConfig,
        place.value,
        days,
        signals,
      );
      return forecast.ok
        ? formatWeather(place.value, forecast.value)
        : forecast.error;
    },
  };
}
