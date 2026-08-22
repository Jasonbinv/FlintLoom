import type { Context } from "@flintloom/kernel";
import type { ChannelRegistry } from "@flintloom/channel";
import type { SessionStore } from "@flintloom/session";
import { botPost } from "./bot.ts";
import type { TelegramConfig } from "./config.ts";
import { sessionHasWaitingTurn } from "./waiting.ts";

function isAbort(signal: AbortSignal, err: unknown): boolean {
  return signal.aborted || (err instanceof Error && err.name === "AbortError");
}

export function startTelegramPoller(ctx: Context, parsed: TelegramConfig): () => void {
  const ac = new AbortController();
  void runTelegramLoop(ctx, parsed, ac.signal);
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

async function runTelegramLoop(
  ctx: Context,
  parsed: TelegramConfig,
  signal: AbortSignal,
): Promise<void> {
  let cleared = false;
  let offset = 0;
  const workspaceRoot = parsed.workspaceRoot;
  if (workspaceRoot === undefined) {
    return;
  }
  while (!signal.aborted) {
    try {
      if (!cleared) {
        await botPost(parsed, "deleteWebhook", { drop_pending_updates: true }, signal);
        cleared = true;
        continue;
      }
      const json = (await botPost(
        parsed,
        "getUpdates",
        { offset, timeout: 30, allowed_updates: ["message"] },
        signal,
      )) as { result?: unknown };
      const result = json.result;
      if (!Array.isArray(result)) {
        throw new Error("getUpdates");
      }
      const bad = result.some((item) => {
        if (item === null || typeof item !== "object" || !("update_id" in item)) {
          return true;
        }
        const id = (item as { update_id: unknown }).update_id;
        return typeof id !== "number" || !Number.isInteger(id) || !Number.isFinite(id);
      });
      if (bad) {
        throw new Error("getUpdates");
      }
      const channels = ctx.require<ChannelRegistry>("channels");
      const sessions = ctx.require<SessionStore>("sessions");
      const busy = ctx.require<Set<string>>("turnBusy");
      for (const item of result) {
        const update = item as {
          update_id: number;
          message?: { chat?: { id?: unknown }; text?: unknown };
        };
        offset = update.update_id + 1;
        const chatId = update.message?.chat?.id;
        if (typeof chatId !== "number" || !Number.isSafeInteger(chatId)) {
          continue;
        }
        const chatKey = String(chatId);
        if (!parsed.allowedChatIds.has(chatKey)) {
          continue;
        }
        if (typeof update.message?.text !== "string") {
          continue;
        }
        const text = update.message.text.trim();
        if (text.length === 0) {
          continue;
        }
        const sessionId = `telegram:${chatKey}`;
        const session = sessions.getOrCreate(sessionId);
        if (busy.has(sessionId) || sessionHasWaitingTurn(session)) {
          continue;
        }
        busy.add(sessionId);
        void runInboundThenReply({
          channels,
          busy,
          sessionId,
          text,
          workspaceRoot,
          signal,
        });
      }
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

async function runInboundThenReply(opts: {
  channels: ChannelRegistry;
  busy: Set<string>;
  sessionId: string;
  text: string;
  workspaceRoot: string;
  signal: AbortSignal;
}): Promise<void> {
  try {
    const result = await opts.channels.inbound("telegram", {
      text: opts.text,
      sessionId: opts.sessionId,
      workspaceRoot: opts.workspaceRoot,
      signal: opts.signal,
    });
    if (opts.signal.aborted) {
      return;
    }
    void result;
  } catch (err) {
    if (isAbort(opts.signal, err)) {
      return;
    }
  } finally {
    opts.busy.delete(opts.sessionId);
  }
}
