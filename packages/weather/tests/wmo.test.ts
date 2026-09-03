import { describe, expect, it } from "vitest";
import { weatherCodeText } from "../src/wmo.ts";

describe("weatherCodeText", () => {
  it("maps documented codes", () => {
    expect(weatherCodeText(0)).toBe("Clear sky");
    expect(weatherCodeText(2)).toBe("Partly cloudy");
    expect(weatherCodeText(61)).toBe("Slight rain");
    expect(weatherCodeText(95)).toBe("Thunderstorm");
  });

  it("falls back for unknown codes", () => {
    expect(weatherCodeText(999)).toBe("WMO 999");
  });
});
