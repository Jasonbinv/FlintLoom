export type WeatherConfig = {
  fetch?: typeof fetch;
};

export type WeatherOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export type GeoPlace = {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string;
  timezone?: string;
};

export type WeatherSignals = {
  user: AbortSignal;
  combined: AbortSignal;
};

export type CurrentWeather = {
  time?: string;
  temperature: number;
  humidity: number;
  weatherCode: number;
  windKmh: number;
};

export type DailyWeather = {
  date: string;
  min: number;
  max: number;
  weatherCode: number;
  rainChance?: number;
};

export type ForecastResult = {
  timezone?: string;
  current: CurrentWeather;
  daily: DailyWeather[];
};
