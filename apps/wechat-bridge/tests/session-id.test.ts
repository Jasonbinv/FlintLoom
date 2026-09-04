import { describe, expect, it } from "vitest";
import { isAllowedSender, wechatSessionId } from "../src/session-id.ts";
import { chunkWechatText } from "../src/text.ts";

describe("session-id", () => {
  it("uses room id for group chats", () => {
    expect(wechatSessionId("wxid_a", "room@chatroom")).toBe("wechat:room@chatroom");
  });

  it("uses from id for direct chats", () => {
    expect(wechatSessionId("wxid_a")).toBe("wechat:wxid_a");
  });
});

describe("isAllowedSender", () => {
  it("allows wildcard", () => {
    expect(isAllowedSender("any", undefined, new Set(["*"]))).toBe(true);
  });

  it("allows by room id", () => {
    expect(
      isAllowedSender("wxid_a", "room@chatroom", new Set(["room@chatroom"])),
    ).toBe(true);
  });
});

describe("chunkWechatText", () => {
  it("splits long replies", () => {
    const chunks = chunkWechatText("a".repeat(2500));
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.length).toBe(2000);
  });
});
