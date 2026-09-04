import { describe, expect, it } from "vitest";
import { parseFeishuConfig } from "../src/config.ts";
import { feishuTextFromContent } from "../src/message.ts";

describe("parseFeishuConfig", () => {
  it("throws appId appSecret allowedChatIds workspaceRoot", () => {
    expect(() => parseFeishuConfig({})).toThrow(/appId/);
    expect(() => parseFeishuConfig({ appId: "cli_1" })).toThrow(/appSecret/);
    expect(() =>
      parseFeishuConfig({ appId: "cli_1", appSecret: "sec" }),
    ).toThrow(/allowedChatIds/);
    expect(() =>
      parseFeishuConfig({
        appId: "cli_1",
        appSecret: "sec",
        allowedChatIds: ["chat_bad"],
      }),
    ).toThrow(/allowedChatIds/);
    expect(() =>
      parseFeishuConfig({
        appId: "cli_1",
        appSecret: "sec",
        allowedChatIds: ["oc_abc"],
        poll: true,
      }),
    ).toThrow(/workspaceRoot/);
  });

  it("accepts feishu chat ids", () => {
    const parsed = parseFeishuConfig({
      appId: "cli_1",
      appSecret: "sec",
      allowedChatIds: ["oc_abc", "oc_def"],
    });
    expect(parsed.allowedChatIds.has("oc_abc")).toBe(true);
  });
});

describe("feishuTextFromContent", () => {
  it("parses text content json", () => {
    expect(feishuTextFromContent('{"text":" hello "}') ).toBe("hello");
  });
});
