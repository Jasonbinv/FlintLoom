import type { Context } from "@flintloom/kernel";
import type { ChannelRegistry } from "@flintloom/channel";
import type { SessionStore } from "@flintloom/session";
import { slackApi } from "./api.ts";
import type { SlackConfig } from "./config.ts";
import { sessionHasWaitingTurn } from "./waiting.ts";

type SlackMessage = {
  ts?: string;
  text?: string;
  subtype?: string;
  bot_id?: string;
};

function isAbort(signal: AbortSignal, err: unknown): boolean {
  return signal.aborted || (err instanceof Error && err.name === "AbortError");
}

export function startSlackPoller(ctx: Context, parsed: SlackConfig): () => void {
  const ac = new AbortController();
  void runSlackLoop(ctx, parsed, ac.signal);
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
  parsed: SlackConfig,
  channelId: string,
  signal: AbortSignal,
): Promise<SlackMessage | undefined> {
  const json = await slackApi(
    parsed,
    `conversations.history?channel=${encodeURIComponent(channelId)}&limit=1`,
    { method: "GET" },
    signal,
  );
  const messages = json.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return undefined;
  }
  const message = messages[0];
  if (message === null || typeof message !== "object") {
    throw new Error("messages");
  }
  return message as SlackMessage;
}

function shouldIgnoreMessage(message: SlackMessage): boolean {
  if (typeof message.subtype === "string" && message.subtype.length > 0) {
    return true;
  }
  if (typeof message.bot_id === "string" && message.bot_id.length > 0) {
    return true;
  }
  return false;
}

async function runSlackLoop(
  ctx: Context,
  parsed: SlackConfig,
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
        for (const channelId of parsed.allowedChannelIds) {
          const latest = await fetchLatestMessage(parsed, channelId, signal);
          if (typeof latest?.ts === "string") {
            lastSeen.set(channelId, latest.ts);
          }
        }
        initialized = true;
        continue;
      }

      const channels = ctx.require<ChannelRegistry>("channels");
      const sessions = ctx.require<SessionStore>("sessions");
      const busy = ctx.require<Set<string>>("turnBusy");

      for (const channelId of parsed.allowedChannelIds) {
        const latest = await fetchLatestMessage(parsed, channelId, signal);
        if (latest === undefined) {
          continue;
        }
        const ts = latest.ts;
        if (typeof ts !== "string" || ts.length === 0) {
          continue;
        }
        if (lastSeen.get(channelId) === ts) {
          continue;
        }
        lastSeen.set(channelId, ts);
        if (shouldIgnoreMessage(latest)) {
          continue;
        }
        const text = typeof latest.text === "string" ? latest.text.trim() : "";
        if (text.length === 0) {
          continue;
        }
        const sessionId = `slack:${channelId}`;
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
    await opts.channels.inbound("slack", {
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
