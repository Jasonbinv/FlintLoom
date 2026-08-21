import { describe, expect, it } from "vitest";
import { parseTelegramConfig } from "../src/config.ts";

describe("parseTelegramConfig", () => {
  it("throws token or allowedChatIds or workspaceRoot", () => {
    expect(() => parseTelegramConfig({})).toThrow(/token/);
    expect(() => parseTelegramConfig({ token: "" })).toThrow(/token/);
    expect(() => parseTelegramConfig({ token: "tok" })).toThrow(/allowedChatIds/);
    expect(() => parseTelegramConfig({ token: "tok", allowedChatIds: [] })).toThrow(
      /allowedChatIds/,
    );
    expect(() =>
      parseTelegramConfig({ token: "tok", allowedChatIds: [{}] }),
    ).toThrow(/allowedChatIds/);
    expect(() =>
      parseTelegramConfig({
        token: "tok",
        allowedChatIds: [1],
        poll: true,
      }),
    ).toThrow(/workspaceRoot/);
  });

  it("accepts number and decimal string chat ids without polling", () => {
    const parsed = parseTelegramConfig({
      token: "tok",
      allowedChatIds: [123, "-100123"],
    });
    expect(parsed.token).toBe("tok");
    expect(parsed.poll).toBe(false);
    expect(parsed.workspaceRoot).toBeUndefined();
    expect(parsed.allowedChatIds.has("123")).toBe(true);
    expect(parsed.allowedChatIds.has("-100123")).toBe(true);
    expect(parsed.apiFetch).toBe(globalThis.fetch);
  });
});
