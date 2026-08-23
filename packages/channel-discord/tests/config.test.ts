import { describe, expect, it } from "vitest";
import { parseDiscordConfig } from "../src/config.ts";

describe("parseDiscordConfig", () => {
  it("throws token or allowedChannelIds or workspaceRoot", () => {
    expect(() => parseDiscordConfig({})).toThrow(/token/);
    expect(() => parseDiscordConfig({ token: "" })).toThrow(/token/);
    expect(() => parseDiscordConfig({ token: "tok" })).toThrow(/allowedChannelIds/);
    expect(() => parseDiscordConfig({ token: "tok", allowedChannelIds: [] })).toThrow(
      /allowedChannelIds/,
    );
    expect(() =>
      parseDiscordConfig({
        token: "tok",
        allowedChannelIds: ["123"],
        poll: true,
      }),
    ).toThrow(/workspaceRoot/);
  });

  it("accepts channel ids without polling", () => {
    const parsed = parseDiscordConfig({
      token: "tok",
      allowedChannelIds: ["123", "456"],
    });
    expect(parsed.token).toBe("tok");
    expect(parsed.poll).toBe(false);
    expect(parsed.allowedChannelIds.has("123")).toBe(true);
    expect(parsed.allowedChannelIds.has("456")).toBe(true);
  });
});
