import type { IncomingMessage, ServerResponse } from "node:http";
import type { ChannelRegistry } from "@flintloom/channel";
import type { WecomConfig } from "./config.ts";
import { wecomSessionId } from "./adapter.ts";
import {
  decryptWecomEcho,
  decryptWecomMessage,
  verifyWecomSignature,
} from "./crypto.ts";
import { parseWecomEncryptXml, parseWecomInboundXml } from "./xml.ts";

function send(res: ServerResponse, status: number, body?: string): void {
  res.writeHead(status);
  res.end(body);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function queryParam(url: URL, key: string): string {
  return url.searchParams.get(key) ?? "";
}

function decodeInboundXml(
  parsed: WecomConfig,
  rawBody: string,
  timestamp: string,
  nonce: string,
  msgSignature: string,
): string | undefined {
  if (parsed.encodingAesKey === undefined) {
    return rawBody;
  }
  const encrypt = parseWecomEncryptXml(rawBody);
  if (encrypt === undefined) {
    return undefined;
  }
  if (
    !verifyWecomSignature(parsed.callbackToken, timestamp, nonce, encrypt, msgSignature)
  ) {
    throw new Error("signature");
  }
  return decryptWecomMessage(parsed.encodingAesKey, parsed.corpId, encrypt);
}

export async function handleWecomCallback(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    pathname: string;
    method: string;
    config: WecomConfig | undefined;
    channels: ChannelRegistry | undefined;
    busy: Set<string>;
    workspaceRoot: string;
  },
): Promise<boolean> {
  if (opts.pathname !== "/v1/channels/wecom/callback") {
    return false;
  }
  if (opts.config === undefined || opts.channels === undefined || !opts.channels.has("wecom")) {
    send(res, 404);
    return true;
  }
  const parsed = opts.config;
  const url = new URL(req.url ?? "/", "http://localhost");
  const timestamp = queryParam(url, "timestamp");
  const nonce = queryParam(url, "nonce");
  const msgSignature = queryParam(url, "msg_signature");

  if (req.method === "GET") {
    const echostr = queryParam(url, "echostr");
    if (echostr.length === 0) {
      send(res, 400);
      return true;
    }
    try {
      if (parsed.encodingAesKey === undefined) {
        send(res, 200, echostr);
        return true;
      }
      if (
        !verifyWecomSignature(parsed.callbackToken, timestamp, nonce, echostr, msgSignature)
      ) {
        send(res, 403);
        return true;
      }
      const plain = decryptWecomEcho(parsed.encodingAesKey, parsed.corpId, echostr);
      send(res, 200, plain);
      return true;
    } catch {
      send(res, 403);
      return true;
    }
  }

  if (req.method !== "POST") {
    send(res, 405);
    return true;
  }

  const rawBody = await readBody(req);
  let inboundXml: string;
  try {
    const decoded = decodeInboundXml(parsed, rawBody, timestamp, nonce, msgSignature);
    if (decoded === undefined) {
      send(res, 400);
      return true;
    }
    inboundXml = decoded;
  } catch (err) {
    if (err instanceof Error && err.message === "signature") {
      send(res, 403);
      return true;
    }
    send(res, 400);
    return true;
  }

  const message = parseWecomInboundXml(inboundXml);
  if (message === undefined) {
    send(res, 200, "success");
    return true;
  }
  if (!parsed.allowedUserIds.has(message.fromUser)) {
    send(res, 200, "success");
    return true;
  }

  const sessionId = wecomSessionId(message.fromUser);
  if (opts.busy.has(sessionId)) {
    send(res, 409);
    return true;
  }

  const sessions = opts.channels;
  opts.busy.add(sessionId);
  const controller = new AbortController();
  const onClose = () => {
    controller.abort();
  };
  req.on("close", onClose);
  res.on("close", onClose);
  try {
    await sessions.inbound("wecom", {
      text: message.content,
      sessionId,
      workspaceRoot: opts.workspaceRoot,
      signal: controller.signal,
    });
    req.off("close", onClose);
    res.off("close", onClose);
    if (!res.destroyed && !res.writableEnded && !res.headersSent) {
      send(res, 200, "success");
    }
  } finally {
    req.off("close", onClose);
    res.off("close", onClose);
    opts.busy.delete(sessionId);
  }
  return true;
}
