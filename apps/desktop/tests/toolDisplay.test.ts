import { describe, expect, it } from "vitest";
import { toolDisplaySummary, toolDisplayTitle } from "../src/toolDisplay.ts";

describe("toolDisplay", () => {
  it("titles web_search as Web", () => {
    expect(toolDisplayTitle("web_search")).toBe("Web");
  });

  it("titles infographic_render as Infographic", () => {
    expect(toolDisplayTitle("infographic_render")).toBe("Infographic");
  });

  it("summarizes web_search by query", () => {
    expect(toolDisplaySummary("web_search", { query: "天气" })).toBe("天气");
  });

  it("titles get_weather as Weather", () => {
    expect(toolDisplayTitle("get_weather")).toBe("Weather");
  });

  it("summarizes get_weather by location", () => {
    expect(toolDisplaySummary("get_weather", { location: "北京" })).toBe("北京");
  });
});
