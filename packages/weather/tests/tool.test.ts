import { describe, expect, it } from "vitest";
import { createGetWeatherTool } from "../src/tool.ts";

const exec = {
  workspaceRoot: ".",
  signal: new AbortController().signal,
  channel: "host",
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("createGetWeatherTool", () => {
  it("rejects short locations without fetching", async () => {
    let calls = 0;
    const tool = createGetWeatherTool({
      fetch: async () => {
        calls += 1;
        return jsonResponse({});
      },
    });
    expect(await tool.execute({ location: " " }, exec)).toBe("failed: empty location");
    expect(await tool.execute({ location: "a" }, exec)).toBe("failed: empty location");
    expect(await tool.execute({ location: "  x" }, exec)).toBe("failed: empty location");
    expect(calls).toBe(0);
  });

  it("clamps invalid days to 7 and returns formatted weather", async () => {
    const seen: string[] = [];
    const tool = createGetWeatherTool({
      fetch: async (input) => {
        const url = String(input);
        seen.push(url);
        if (url.includes("geocoding-api")) {
          return jsonResponse({
            results: [
              {
                name: "Beijing",
                latitude: 39.9,
                longitude: 116.4,
                country: "China",
                timezone: "Asia/Shanghai",
              },
            ],
          });
        }
        return jsonResponse({
          timezone: "Asia/Shanghai",
          current: {
            time: "2026-09-03T15:00",
            temperature_2m: 22,
            relative_humidity_2m: 55,
            weather_code: 0,
            wind_speed_10m: 10,
          },
          daily: {
            time: ["2026-09-03"],
            temperature_2m_max: [28],
            temperature_2m_min: [18],
            weather_code: [0],
            precipitation_probability_max: [10],
          },
        });
      },
    });
    const text = await tool.execute({ location: "北京", days: 99 }, exec);
    expect(text).toContain("Location: Beijing, China");
    expect(text).toContain("Clear sky");
    expect(text).toContain("Source: Open-Meteo");
    expect(seen.some((u) => u.includes("forecast_days=7"))).toBe(true);
  });

  it("returns aborted when the caller signal is aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const tool = createGetWeatherTool({
      fetch: async (_input, init) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          throw new DOMException("aborted", "AbortError");
        }
        return jsonResponse({});
      },
    });
    expect(
      await tool.execute({ location: "Beijing" }, { ...exec, signal: ac.signal }),
    ).toBe("aborted");
  });

  it("returns failed: timeout on TimeoutError", async () => {
    const tool = createGetWeatherTool({
      fetch: async () => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      },
    });
    expect(await tool.execute({ location: "Beijing" }, exec)).toBe("failed: timeout");
  });
});
