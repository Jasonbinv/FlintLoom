import { describe, expect, it } from "vitest";
import { parseSlackConfig } from "../src/config.ts";

describe("parseSlackConfig", () => {
  it("throws token or allowedChannelIds or workspaceRoot", () => {
    expect(() => parseSlackConfig({})).toThrow(/token/);
    expect(() => parseSlackConfig({ token: "xoxb-1" })).toThrow(/allowedChannelIds/);
    expect(() =>
      parseSlackConfig({
        token: "xoxb-1",
        allowedChannelIds: ["C01234567"],
        poll: true,
      }),
    ).toThrow(/workspaceRoot/);
  });

  it("accepts slack channel ids", () => {
    const parsed = parseSlackConfig({
      token: "xoxb-1",
      allowedChannelIds: ["C01234567", "G01234567"],
    });
    expect(parsed.allowedChannelIds.has("C01234567")).toBe(true);
    expect(parsed.allowedChannelIds.has("G01234567")).toBe(true);
  });
});
