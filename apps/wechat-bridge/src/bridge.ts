import {
  createFlintHookClient,
  flintHookErrorMessage,
  type FlintHookClient,
} from "./flint-hook.ts";
import { isAllowedSender, wechatSessionId } from "./session-id.ts";
import { chunkWechatText } from "./text.ts";

export type InboundMessage = {
  from: string;
  text: string;
  room?: string;
};

export type OutboundSink = {
  sendReply(message: InboundMessage, text: string): Promise<void>;
};

export type Bridge = {
  handleInbound(message: InboundMessage, signal?: AbortSignal): Promise<string>;
};

export function createBridge(opts: {
  hook: FlintHookClient;
  allowedFrom: Set<string> | undefined;
}): Bridge {
  return {
    async handleInbound(message, signal) {
      const text = message.text.trim();
      if (text.length === 0) {
        return "";
      }
      if (!isAllowedSender(message.from, message.room, opts.allowedFrom)) {
        return "";
      }
      const sessionId = wechatSessionId(message.from, message.room);
      try {
        const result = await opts.hook.call(sessionId, text, signal);
        return result.text;
      } catch (err) {
        return flintHookErrorMessage(err);
      }
    },
  };
}

export async function handleInboundWithSink(
  bridge: Bridge,
  sink: OutboundSink,
  message: InboundMessage,
  signal?: AbortSignal,
): Promise<void> {
  const reply = await bridge.handleInbound(message, signal);
  for (const chunk of chunkWechatText(reply)) {
    await sink.sendReply(message, chunk);
  }
}

export function createBridgeFromConfig(opts: {
  hookUrl: string;
  hostToken: string;
  allowedFrom: Set<string> | undefined;
  fetchImpl?: typeof fetch;
}): Bridge {
  const hook = createFlintHookClient({
    hookUrl: opts.hookUrl,
    hostToken: opts.hostToken,
    fetchImpl: opts.fetchImpl,
  });
  return createBridge({ hook, allowedFrom: opts.allowedFrom });
}
