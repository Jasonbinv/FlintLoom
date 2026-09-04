import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  maskSecret,
  normalizeCredentialsStore,
  readCredentialsStore,
  writeCredentialsStore,
} from "../src/credentials.ts";
import { applyCredentialPatch } from "../src/settings.ts";

describe("maskSecret", () => {
  it("masks short secrets as stars", () => {
    expect(maskSecret("local")).toBe("***");
  });

  it("masks long secrets with head and tail", () => {
    expect(maskSecret("sk-abcdefghijklmnop")).toBe("sk-a…mnop");
  });
});

describe("credentials store", () => {
  it("writes and reads providers.media", () => {
    const home = mkdtempSync(join(tmpdir(), "flintloom-cred-"));
    writeCredentialsStore(home, {
      providers: {
        media: { apiKey: "sk-test", baseUrl: "https://example.com/v1" },
      },
    });
    const store = readCredentialsStore(home);
    expect(store.providers?.media?.apiKey).toBe("sk-test");
    expect(store.providers?.media?.baseUrl).toBe("https://example.com/v1");
  });

  it("normalizes legacy chatApiKey into providers.chat", () => {
    const normalized = normalizeCredentialsStore({ chatApiKey: "sk-legacy" });
    expect(normalized.providers?.chat?.apiKey).toBe("sk-legacy");
  });

  it("applyCredentialPatch stores wecom fields", () => {
    const home = mkdtempSync(join(tmpdir(), "flintloom-cred-wecom-"));
    applyCredentialPatch(home, "wecom", {
      appId: "ww_test",
      apiKey: "corp-secret",
      agentId: "1000002",
      callbackToken: "cbtok",
      allowedChatIds: "zhangsan,lisi",
    });
    const store = readCredentialsStore(home);
    expect(store.channels?.wecom).toEqual({
      corpId: "ww_test",
      corpSecret: "corp-secret",
      agentId: "1000002",
      callbackToken: "cbtok",
      allowedUserIds: "zhangsan,lisi",
    });
  });
});
