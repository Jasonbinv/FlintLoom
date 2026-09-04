import { describe, expect, it } from "vitest";
import { parseWecomConfig } from "../src/config.ts";
import { parseWecomInboundXml } from "../src/xml.ts";

describe("parseWecomConfig", () => {
  it("throws for missing required fields", () => {
    expect(() => parseWecomConfig({})).toThrow(/corpId/);
    expect(() => parseWecomConfig({ corpId: "ww_1" })).toThrow(/corpSecret/);
    expect(() =>
      parseWecomConfig({ corpId: "ww_1", corpSecret: "sec" }),
    ).toThrow(/agentId/);
    expect(() =>
      parseWecomConfig({
        corpId: "ww_1",
        corpSecret: "sec",
        agentId: "1000002",
      }),
    ).toThrow(/callbackToken/);
    expect(() =>
      parseWecomConfig({
        corpId: "ww_1",
        corpSecret: "sec",
        agentId: "1000002",
        callbackToken: "tok",
      }),
    ).toThrow(/allowedUserIds/);
    expect(() =>
      parseWecomConfig({
        corpId: "ww_1",
        corpSecret: "sec",
        agentId: "1000002",
        callbackToken: "tok",
        allowedUserIds: ["bad id"],
      }),
    ).toThrow(/allowedUserIds/);
    expect(() =>
      parseWecomConfig({
        corpId: "ww_1",
        corpSecret: "sec",
        agentId: "1000002",
        callbackToken: "tok",
        allowedUserIds: ["zhangsan"],
      }),
    ).toThrow(/workspaceRoot/);
  });

  it("accepts valid wecom config", () => {
    const parsed = parseWecomConfig({
      corpId: "ww_1",
      corpSecret: "sec",
      agentId: "1000002",
      callbackToken: "tok",
      allowedUserIds: ["zhangsan"],
      workspaceRoot: "/ws",
    });
    expect(parsed.agentId).toBe(1000002);
    expect(parsed.allowedUserIds.has("zhangsan")).toBe(true);
  });
});

describe("parseWecomInboundXml", () => {
  it("parses plaintext text messages", () => {
    const xml = `<xml>
<ToUserName><![CDATA[toUser]]></ToUserName>
<FromUserName><![CDATA[zhangsan]]></FromUserName>
<CreateTime>1348831860</CreateTime>
<MsgType><![CDATA[text]]></MsgType>
<Content><![CDATA[hello wecom]]></Content>
<MsgId>1234567890123456</MsgId>
<AgentID>1</AgentID>
</xml>`;
    const message = parseWecomInboundXml(xml);
    expect(message?.fromUser).toBe("zhangsan");
    expect(message?.content).toBe("hello wecom");
  });
});
