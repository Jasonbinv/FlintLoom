import type { Context } from "@flintloom/kernel";
import type { ChannelRegistry } from "@flintloom/channel";
import type { SessionStore } from "@flintloom/session";
import { feishuApi } from "./api.ts";
import type { FeishuConfig } from "./config.ts";
import { feishuTextFromContent } from "./message.ts";
import { sessionHasWaitingTurn } from "./waiting.ts";

type FeishuMessage = {
  message_id?: string;
  create_time?: string;
  msg_type?: string;
  body?: { content?: unknown };
  sender?: { sender_type?: string };
};

function isAbort(signal: AbortSignal, err: unknown): boolean {
  return signal.aborted || (err instanceof Error && err.name === "AbortError");
}

export function startFeishuPoller(ctx: Context, parsed: FeishuConfig): () => void {
  const ac = new AbortController();
  void runFeishuLoop(ctx, parsed, ac.signal);
  return () => {
    ac.abort();
  };
}

async function delay(signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, 1000);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function fetchLatestMessage(
  parsed: FeishuConfig,
  chatId: string,
  signal: AbortSignal,
): Promise<FeishuMessage | undefined> {
  const json = await feishuApi(
    parsed,
    `/im/v1/messages?container_id_type=chat&container_id=${encodeURIComponent(chatId)}&page_size=1&sort_type=ByCreateTimeDesc`,
    { method: "GET" },
    signal,
  );
  const data = json.data;
  if (data === null || typeof data !== "object") {
    throw new Error("messages");
  }
  const items = (data as { items?: unknown }).items;
  if (!Array.isArray(items) || items.length === 0) {
    return undefined;
  }
  const message = items[0];
  if (message === null || typeof message !== "object") {
    throw new Error("messages");
  }
  return message as FeishuMessage;
}

async function runFeishuLoop(
  ctx: Context,
  parsed: FeishuConfig,
  signal: AbortSignal,
): Promise<void> {
  const workspaceRoot = parsed.workspaceRoot;
  if (workspaceRoot === undefined) {
    return;
  }
  const lastSeen = new Map<string, string>();
  let initialized = false;

  while (!signal.aborted) {
    try {
      if (!initialized) {
        for (const chatId of parsed.allowedChatIds) {
          const latest = await fetchLatestMessage(parsed, chatId, signal);
          if (typeof latest?.message_id === "string") {
            lastSeen.set(chatId, latest.message_id);
          }
        }
        initialized = true;
        continue;
      }

      const channels = ctx.require<ChannelRegistry>("channels");
      const sessions = ctx.require<SessionStore>("sessions");
      const busy = ctx.require<Set<string>>("turnBusy");

      for (const chatId of parsed.allowedChatIds) {
        const latest = await fetchLatestMessage(parsed, chatId, signal);
        if (latest === undefined) {
          continue;
        }
        const messageId = latest.message_id;
        if (typeof messageId !== "string" || messageId.length === 0) {
          continue;
        }
        if (lastSeen.get(chatId) === messageId) {
          continue;
        }
        lastSeen.set(chatId, messageId);
        if (latest.sender?.sender_type === "app") {
          continue;
        }
        if (latest.msg_type !== "text") {
          continue;
        }
        const text = feishuTextFromContent(latest.body?.content);
        if (text === undefined) {
          continue;
        }
        const sessionId = `feishu:${chatId}`;
        const session = sessions.getOrCreate(sessionId);
        if (busy.has(sessionId) || sessionHasWaitingTurn(session)) {
          continue;
        }
        busy.add(sessionId);
        void runInbound({
          channels,
          busy,
          sessionId,
          text,
          workspaceRoot,
          signal,
        });
      }
      await delay(signal);
    } catch (err) {
      if (isAbort(signal, err)) {
        return;
      }
      try {
        await delay(signal);
      } catch {
        return;
      }
    }
  }
}

async function runInbound(opts: {
  channels: ChannelRegistry;
  busy: Set<string>;
  sessionId: string;
  text: string;
  workspaceRoot: string;
  signal: AbortSignal;
}): Promise<void> {
  try {
    await opts.channels.inbound("feishu", {
      text: opts.text,
      sessionId: opts.sessionId,
      workspaceRoot: opts.workspaceRoot,
      signal: opts.signal,
    });
  } catch (err) {
    if (isAbort(opts.signal, err)) {
      return;
    }
  } finally {
    opts.busy.delete(opts.sessionId);
  }
}
