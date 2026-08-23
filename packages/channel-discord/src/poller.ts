import type { Context } from "@flintloom/kernel";
import type { ChannelRegistry } from "@flintloom/channel";
import type { SessionStore } from "@flintloom/session";
import { discordApi } from "./api.ts";
import type { DiscordConfig } from "./config.ts";
import { sessionHasWaitingTurn } from "./waiting.ts";

type DiscordMessage = {
  id: string;
  content?: string;
  author?: { bot?: boolean };
};

function isAbort(signal: AbortSignal, err: unknown): boolean {
  return signal.aborted || (err instanceof Error && err.name === "AbortError");
}

export function startDiscordPoller(ctx: Context, parsed: DiscordConfig): () => void {
  const ac = new AbortController();
  void runDiscordLoop(ctx, parsed, ac.signal);
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

async function fetchMessages(
  parsed: DiscordConfig,
  channelId: string,
  after: string | undefined,
  signal: AbortSignal,
): Promise<DiscordMessage[]> {
  const query = after === undefined ? "?limit=1" : `?after=${after}&limit=50`;
  const json = (await discordApi(
    parsed,
    `/channels/${channelId}/messages${query}`,
    { method: "GET" },
    signal,
  )) as DiscordMessage[];
  if (!Array.isArray(json)) {
    throw new Error("messages");
  }
  return json;
}

async function runDiscordLoop(
  ctx: Context,
  parsed: DiscordConfig,
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
          const latest = await fetchMessages(parsed, channelId, undefined, signal);
          if (latest[0]?.id !== undefined) {
            lastSeen.set(channelId, latest[0].id);
          }
        }
        initialized = true;
        continue;
      }

      const channels = ctx.require<ChannelRegistry>("channels");
      const sessions = ctx.require<SessionStore>("sessions");
      const busy = ctx.require<Set<string>>("turnBusy");

      for (const channelId of parsed.allowedChannelIds) {
        const after = lastSeen.get(channelId);
        const messages = await fetchMessages(parsed, channelId, after, signal);
        const ordered = [...messages].reverse();
        for (const message of ordered) {
          if (typeof message.id !== "string" || message.id.length === 0) {
            continue;
          }
          lastSeen.set(channelId, message.id);
          if (message.author?.bot === true) {
            continue;
          }
          const text = typeof message.content === "string" ? message.content.trim() : "";
          if (text.length === 0) {
            continue;
          }
          const sessionId = `discord:${channelId}`;
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
    await opts.channels.inbound("discord", {
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
