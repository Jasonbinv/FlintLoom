import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function sha1Signature(
  token: string,
  timestamp: string,
  nonce: string,
  encrypt: string,
): string {
  const sorted = [token, timestamp, nonce, encrypt].sort().join("");
  return createHash("sha1").update(sorted).digest("hex");
}

function pkcs7Unpad(buffer: Buffer): Buffer {
  const pad = buffer[buffer.length - 1]!;
  if (pad < 1 || pad > 32) {
    throw new Error("pad");
  }
  return buffer.subarray(0, buffer.length - pad);
}

function pkcs7Pad(buffer: Buffer, blockSize = 32): Buffer {
  const pad = blockSize - (buffer.length % blockSize);
  return Buffer.concat([buffer, Buffer.alloc(pad, pad)]);
}

function aesKey(encodingAesKey: string): Buffer {
  return Buffer.from(`${encodingAesKey}=`, "base64");
}

export function verifyWecomSignature(
  token: string,
  timestamp: string,
  nonce: string,
  encrypt: string,
  msgSignature: string,
): boolean {
  return sha1Signature(token, timestamp, nonce, encrypt) === msgSignature;
}

export function encryptWecomMessage(
  encodingAesKey: string,
  corpId: string,
  message: string,
  random = randomBytes(16),
): string {
  const key = aesKey(encodingAesKey);
  const iv = key.subarray(0, 16);
  const msgBuf = Buffer.from(message, "utf8");
  const corpBuf = Buffer.from(corpId, "utf8");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(msgBuf.length, 0);
  const plain = Buffer.concat([random, lenBuf, msgBuf, corpBuf]);
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  cipher.setAutoPadding(false);
  const encrypted = Buffer.concat([cipher.update(pkcs7Pad(plain)), cipher.final()]);
  return encrypted.toString("base64");
}

export function decryptWecomMessage(
  encodingAesKey: string,
  corpId: string,
  encrypted: string,
): string {
  const key = aesKey(encodingAesKey);
  const iv = key.subarray(0, 16);
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  decipher.setAutoPadding(false);
  const decrypted = pkcs7Unpad(
    Buffer.concat([decipher.update(Buffer.from(encrypted, "base64")), decipher.final()]),
  );
  const content = decrypted.subarray(16);
  const msgLen = content.readUInt32BE(0);
  const msg = content.subarray(4, 4 + msgLen).toString("utf8");
  const receivedCorpId = content.subarray(4 + msgLen).toString("utf8");
  if (receivedCorpId !== corpId) {
    throw new Error("corpId");
  }
  return msg;
}

export function decryptWecomEcho(
  encodingAesKey: string,
  corpId: string,
  echostr: string,
): string {
  return decryptWecomMessage(encodingAesKey, corpId, echostr);
}
