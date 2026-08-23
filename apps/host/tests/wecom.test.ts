import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ChatProvider } from "@flintloom/models";
import { ModelRegistry } from "@flintloom/models";
import { resetWecomTokenCache } from "@flintloom/channel-wecom";
import { startHost } from "../src/index.ts";
import { ASSEMBLY } from "./assembly.ts";

function textChat(text: string): ChatProvider {
  return {
    async *stream() {
      yield { type: "text", text };
    },
  };
}

function wecomFetch(base: typeof fetch): typeof fetch {
  return async (url, init) => {
    const u = String(url);
    if (u.includes("/gettoken")) {
      return new Response(
        JSON.stringify({ errcode: 0, access_token: "tok", expires_in: 7200 }),
        { status: 200 },
      );
    }
    if (u.includes("/message/send")) {
      return new Response(JSON.stringify({ errcode: 0 }), { status: 200 });
    }
    return base(url, init);
  };
}

const WECOM_YML = `${ASSEMBLY}  - id: channel-wecom
    name: "@flintloom/channel-wecom"
`;

function writeWecomAssembly(workspaceRoot: string): void {
  writeFileSync(join(workspaceRoot, "flintloom.yml"), WECOM_YML);
}

describe("wecom host callback", () => {
  let close: (() => Promise<void>) | undefined;
  const originalFetch = globalThis.fetch;

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    resetWecomTokenCache();
    if (close !== undefined) {
      await close();
      close = undefined;
    }
  });

  it("accepts plaintext callback and registers wecom channel", async () => {
    globalThis.fetch = wecomFetch(originalFetch);
    const workspaceRoot = mkdtempSync(join(tmpdir(), "flintloom-wecom-host-"));
    const homeDir = mkdtempSync(join(tmpdir(), "flintloom-wecom-home-"));
    writeWecomAssembly(workspaceRoot);
    writeFileSync(
      join(workspaceRoot, ".env"),
      [
        "FLINTLOOM_WECOM_CORP_ID=ww_test",
        "FLINTLOOM_WECOM_CORP_SECRET=secret",
        "FLINTLOOM_WECOM_AGENT_ID=1000002",
        "FLINTLOOM_WECOM_CALLBACK_TOKEN=cbtok",
        "FLINTLOOM_WECOM_USER_IDS=zhangsan",
      ].join("\n"),
    );
    const host = await startHost({ workspaceRoot, homeDir, port: 0 });
    close = host.close;
    const models = host.runtime.ctx.require<ModelRegistry>("models");
    models.registerChat("fake", textChat("wecom-hello"));
    models.setDefault("chat", "fake");

    const verify = await fetch(`${host.url}/v1/channels/wecom/callback?echostr=hello`);
    expect(verify.status).toBe(200);
    expect(await verify.text()).toBe("hello");

    const inboundXml = `<xml>
<ToUserName><![CDATA[toUser]]></ToUserName>
<FromUserName><![CDATA[zhangsan]]></FromUserName>
<CreateTime>1348831860</CreateTime>
<MsgType><![CDATA[text]]></MsgType>
<Content><![CDATA[ping]]></Content>
<MsgId>1234567890123456</MsgId>
<AgentID>1000002</AgentID>
</xml>`;
    const inbound = await fetch(`${host.url}/v1/channels/wecom/callback`, {
      method: "POST",
      headers: { "Content-Type": "text/xml" },
      body: inboundXml,
    });
    expect(inbound.status).toBe(200);
    expect(await inbound.text()).toBe("success");
  });
});
