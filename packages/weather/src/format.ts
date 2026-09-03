import type { ForecastResult, GeoPlace } from "./types.ts";
import { weatherCodeText } from "./wmo.ts";

export function formatWeather(
  place: GeoPlace,
  forecast: ForecastResult,
): string {
  const location = [
    place.name,
    place.admin1 !== place.name ? place.admin1 : undefined,
    place.country,
  ]
    .filter(Boolean)
    .join(", ");
  const lines = [
    `Location: ${location} (${place.latitude.toFixed(2)}, ${place.longitude.toFixed(2)})`,
  ];

  const timezone = place.timezone ?? forecast.timezone;
  if (timezone) {
    lines.push(`Timezone: ${timezone}`);
  }

  const current = forecast.current;
  const currentLabel = current.time ? `Current (${current.time}):` : "Current:";
  lines.push(
    `${currentLabel} ${Math.round(current.temperature)}°C, ${weatherCodeText(current.weatherCode)}, humidity ${Math.round(current.humidity)}%, wind ${Math.round(current.windKmh)} km/h`,
  );

  if (forecast.daily.length > 0) {
    lines.push("Daily:");
  }
  for (const day of forecast.daily) {
    const rain =
      day.rainChance === undefined
        ? ""
        : `  rain ${day.rainChance}%`;
    lines.push(
      `${day.date}  ${Math.round(day.min)}/${Math.round(day.max)}°C  ${weatherCodeText(day.weatherCode)}${rain}`,
    );
  }

  lines.push("Source: Open-Meteo");
  return lines.join("\n").slice(0, 8000);
}
