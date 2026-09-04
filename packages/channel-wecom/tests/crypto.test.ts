import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildWecomEncryptedReply,
  decryptWecomEcho,
  decryptWecomMessage,
  encryptWecomMessage,
  signWecomSignature,
  verifyWecomSignature,
} from "../src/crypto.ts";
import { parseWecomEncryptXml } from "../src/xml.ts";

const ENCODING_AES_KEY = "B5lpjOtetwGroJdq29oRJifgTHAmUVcFPZlznhgaeuQ";
const CORP_ID = "ww_test_corp";

function wecomSignature(
  token: string,
  timestamp: string,
  nonce: string,
  encrypt: string,
): string {
  const sorted = [token, timestamp, nonce, encrypt].sort().join("");
  return createHash("sha1").update(sorted).digest("hex");
}

describe("wecom crypto", () => {
  it("verifyWecomSignature matches sorted sha1", () => {
    const token = "cbtok";
    const timestamp = "1409659589";
    const nonce = "263014780";
    const encrypt = "test-echo";
    const signature = wecomSignature(token, timestamp, nonce, encrypt);
    expect(verifyWecomSignature(token, timestamp, nonce, encrypt, signature)).toBe(true);
    expect(verifyWecomSignature(token, timestamp, nonce, encrypt, "bad")).toBe(false);
  });

  it("encrypt/decrypt round-trips echo and message payloads", () => {
    const random = Buffer.alloc(16, 7);
    const echo = "hello_echo";
    const encryptedEcho = encryptWecomMessage(ENCODING_AES_KEY, CORP_ID, echo, random);
    expect(decryptWecomEcho(ENCODING_AES_KEY, CORP_ID, encryptedEcho)).toBe(echo);

    const inboundXml = `<xml><Content><![CDATA[ping]]></Content></xml>`;
    const encryptedInbound = encryptWecomMessage(ENCODING_AES_KEY, CORP_ID, inboundXml, random);
    expect(decryptWecomMessage(ENCODING_AES_KEY, CORP_ID, encryptedInbound)).toBe(inboundXml);
  });

  it("decrypt rejects mismatched corpId", () => {
    const encrypted = encryptWecomMessage(ENCODING_AES_KEY, CORP_ID, "hello");
    expect(() => decryptWecomMessage(ENCODING_AES_KEY, "ww_other", encrypted)).toThrow(/corpId/);
  });

  it("buildWecomEncryptedReply produces signed XML decryptable to plain", () => {
    const token = "cbtok";
    const timestamp = "1409659589";
    const nonce = "replynonce";
    const xml = buildWecomEncryptedReply(ENCODING_AES_KEY, CORP_ID, token, "success", {
      timestamp,
      nonce,
    });
    const encrypt = parseWecomEncryptXml(xml);
    expect(encrypt).toBeTruthy();
    const expectedSig = wecomSignature(token, timestamp, nonce, encrypt!);
    expect(signWecomSignature(token, timestamp, nonce, encrypt!)).toBe(expectedSig);
    expect(verifyWecomSignature(token, timestamp, nonce, encrypt!, expectedSig)).toBe(true);
    expect(decryptWecomMessage(ENCODING_AES_KEY, CORP_ID, encrypt!)).toBe("success");
  });
});
