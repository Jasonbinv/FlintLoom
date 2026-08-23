import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWecomSignature } from "../src/crypto.ts";

describe("wecom crypto", () => {
  it("verifyWecomSignature matches sorted sha1", () => {
    const token = "cbtok";
    const timestamp = "1409659589";
    const nonce = "263014780";
    const encrypt = "test-echo";
    const sorted = [token, timestamp, nonce, encrypt].sort().join("");
    const signature = createHash("sha1").update(sorted).digest("hex");
    expect(verifyWecomSignature(token, timestamp, nonce, encrypt, signature)).toBe(true);
    expect(verifyWecomSignature(token, timestamp, nonce, encrypt, "bad")).toBe(false);
  });
});
