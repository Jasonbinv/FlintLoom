import { afterEach, describe, expect, it, vi } from "vitest";
import { Context } from "@flintloom/kernel";
import channelPlugin, { type ChannelRegistry } from "@flintloom/channel";
import modelsPlugin, { type ModelRegistry } from "@flintloom/models";
import sessionPlugin, { type SessionStore } from "@flintloom/session";
import type { LoopService, RunTurnInput } from "@flintloom/loop";
import { parseTelegramConfig } from "../src/config.ts";
import { startTelegramPoller } from "../src/poller.ts";

type Call = { url: string; body: unknown };

function jsonOk(result: unknown): Response {
  return new Response(JSON.stringify({ ok: true, result }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function boot(
  apiFetch: typeof fetch,
  runTurn: LoopService["runTurn"],
  replyText = "reply-text",
) {
  const ctx = new Context();
  ctx.provide("turnBusy", new Set<string>());
  ctx.plugin(modelsPlugin);
  ctx.plugin(sessionPlugin);
  ctx.plugin(channelPlugin);
  ctx.provide("loop", {
    runTurn,
    continueTurn: async () => ({ turnId: "t", status: "ok" as const }),
  });
  const parsed = parseTelegramConfig({
    token: "tok",
    allowedChatIds: [123],
    poll: false,
    apiFetch,
  });
  ctx.require<ChannelRegistry>("channels").register("telegram", {
    async inbound(input) {
      const session = ctx.require<SessionStore>("sessions").getOrCreate(input.sessionId);
      const result = await runTurn({
        ctx,
        session,
        text: input.text,
        workspaceRoot: input.workspaceRoot,
        channel: "telegram",
        signal: input.signal,
      });
      try {
        await ctx.require<ChannelRegistry>("channels").deliver("telegram", {
          sessionId: input.sessionId,
          turnId: result.turnId,
          signal: input.signal,
        });
      } catch (err) {
        if (!(err instanceof Error && err.message === "no deliver")) {
          throw err;
        }
      }
      return { turnId: result.turnId, status: result.status, text: replyText };
    },
    async deliver(outbound) {
      if (replyText.length === 0) {
        return;
      }
      const text =
        replyText.length > 4096 ? replyText.slice(0, 4096) : replyText;
      const chatId = Number(outbound.sessionId.slice("telegram:".length));
      await apiFetch(`https://api.telegram.org/bottok/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
        signal: outbound.signal,
      });
    },
  });
  return ctx;
}

function hangUntilAbort(init?: RequestInit): Promise<Response> {
  return new Promise<void>((_resolve, reject) => {
    const signal = init?.signal;
    const onAbort = () => reject(new DOMException("aborted", "AbortError"));
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  }).then(() => jsonOk([]));
}

describe("startTelegramPoller", () => {
  const stops: Array<() => void> = [];
  afterEach(() => {
    for (const stop of stops.splice(0)) stop();
    vi.useRealTimers();
  });

  it("deleteWebhook before getUpdates then replies to allowlisted text", async () => {
    const calls: Call[] = [];
    const inboundTexts: string[] = [];
    let updates = 0;
    const apiFetch: typeof fetch = async (url, init) => {
      const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
      calls.push({ url: String(url), body });
      if (String(url).includes("deleteWebhook")) {
        return jsonOk(true);
      }
      if (String(url).includes("getUpdates")) {
        updates += 1;
        if (updates === 1) {
          return jsonOk([
            {
              update_id: 10,
              message: { chat: { id: 123 }, photo: [{}] },
            },
            {
              update_id: 11,
              message: { chat: { id: 99 }, text: "nope" },
            },
            {
              update_id: 12,
              message: { chat: { id: 123 }, text: "  hi  " },
            },
          ]);
        }
        await hangUntilAbort(init);
      }
      if (String(url).includes("sendMessage")) {
        return jsonOk({ message_id: 1 });
      }
      return jsonOk([]);
    };
    const ctx = boot(apiFetch, async (input: RunTurnInput) => {
      inboundTexts.push(input.text);
      input.session.append({ type: "turn/start", turnId: "t1" });
      input.session.append({ type: "user/message", text: input.text });
      return { turnId: "t1", status: "ok" };
    });
    const parsed = parseTelegramConfig({
      token: "tok",
      allowedChatIds: [123],
      poll: true,
      workspaceRoot: "/ws",
      apiFetch,
    });
    stops.push(startTelegramPoller(ctx, parsed));
    await vi.waitFor(() => {
      expect(calls.some((c) => c.url.endsWith("/sendMessage"))).toBe(true);
    });
    expect(calls[0]?.url).toBe("https://api.telegram.org/bottok/deleteWebhook");
    expect(calls[0]?.body).toEqual({ drop_pending_updates: true });
    expect(calls.find((c) => c.url.endsWith("/getUpdates"))).toBeTruthy();
    const getIdx = calls.findIndex((c) => c.url.endsWith("/getUpdates"));
    expect(getIdx).toBeGreaterThan(0);
    expect(inboundTexts).toEqual(["hi"]);
    const userMessages = ctx
      .require<SessionStore>("sessions")
      .get("telegram:123")!
      .events()
      .filter((event) => event.type === "user/message");
    expect(userMessages).toEqual([{ type: "user/message", text: "hi" }]);
    const sent = calls.find((c) => c.url.endsWith("/sendMessage"));
    expect(sent?.body).toEqual({ chat_id: 123, text: "reply-text" });
    await vi.waitFor(() => {
      expect(calls.filter((c) => c.url.endsWith("/getUpdates")).length).toBeGreaterThan(1);
    });
    const secondGet = calls.filter((c) => c.url.endsWith("/getUpdates"))[1];
    expect(secondGet?.body).toMatchObject({ offset: 13 });
  });

  it("acks a later same-chat text in one batch without a second inbound", async () => {
    const inboundTexts: string[] = [];
    let updates = 0;
    const apiFetch: typeof fetch = async (url, init) => {
      if (String(url).includes("deleteWebhook")) {
        return jsonOk(true);
      }
      if (String(url).includes("getUpdates")) {
        updates += 1;
        if (updates === 1) {
          return jsonOk([
            { update_id: 1, message: { chat: { id: 123 }, text: "one" } },
            { update_id: 2, message: { chat: { id: 123 }, text: "two" } },
          ]);
        }
        await hangUntilAbort(init);
      }
      if (String(url).includes("sendMessage")) {
        return jsonOk({ message_id: 1 });
      }
      return jsonOk([]);
    };
    const ctx = boot(apiFetch, async (input: RunTurnInput) => {
      inboundTexts.push(input.text);
      return { turnId: "t1", status: "ok" };
    });
    stops.push(
      startTelegramPoller(
        ctx,
        parseTelegramConfig({
          token: "tok",
          allowedChatIds: [123],
          poll: true,
          workspaceRoot: "/ws",
          apiFetch,
        }),
      ),
    );
    await vi.waitFor(() => {
      expect(updates).toBeGreaterThan(1);
    });
    expect(inboundTexts).toEqual(["one"]);
  });

  it("skips when turnBusy already has the session", async () => {
    const inboundTexts: string[] = [];
    let updates = 0;
    const apiFetch: typeof fetch = async (url, init) => {
      if (String(url).includes("deleteWebhook")) return jsonOk(true);
      if (String(url).includes("getUpdates")) {
        updates += 1;
        if (updates === 1) {
          return jsonOk([
            { update_id: 1, message: { chat: { id: 123 }, text: "hi" } },
          ]);
        }
        await hangUntilAbort(init);
      }
      return jsonOk([]);
    };
    const ctx = boot(apiFetch, async (input: RunTurnInput) => {
      inboundTexts.push(input.text);
      return { turnId: "t1", status: "ok" };
    });
    ctx.require<Set<string>>("turnBusy").add("telegram:123");
    stops.push(
      startTelegramPoller(
        ctx,
        parseTelegramConfig({
          token: "tok",
          allowedChatIds: [123],
          poll: true,
          workspaceRoot: "/ws",
          apiFetch,
        }),
      ),
    );
    await vi.waitFor(() => {
      expect(updates).toBeGreaterThan(1);
    });
    expect(inboundTexts).toEqual([]);
  });

  it("does not sendMessage when inbound text is empty", async () => {
    const calls: Call[] = [];
    let updates = 0;
    const apiFetch: typeof fetch = async (url, init) => {
      const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
      calls.push({ url: String(url), body });
      if (String(url).includes("deleteWebhook")) return jsonOk(true);
      if (String(url).includes("getUpdates")) {
        updates += 1;
        if (updates === 1) {
          return jsonOk([
            { update_id: 1, message: { chat: { id: 123 }, text: "hi" } },
          ]);
        }
        await hangUntilAbort(init);
      }
      return jsonOk([]);
    };
    const ctx = boot(apiFetch, async () => ({ turnId: "t1", status: "ok" }), "");
    stops.push(
      startTelegramPoller(
        ctx,
        parseTelegramConfig({
          token: "tok",
          allowedChatIds: [123],
          poll: true,
          workspaceRoot: "/ws",
          apiFetch,
        }),
      ),
    );
    await vi.waitFor(() => {
      expect(updates).toBeGreaterThan(1);
    });
    expect(calls.some((c) => c.url.endsWith("/sendMessage"))).toBe(false);
  });

  it("truncates sendMessage text to 4096", async () => {
    const calls: Call[] = [];
    const reply = "a".repeat(4097);
    let updates = 0;
    const apiFetch: typeof fetch = async (url, init) => {
      const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
      calls.push({ url: String(url), body });
      if (String(url).includes("deleteWebhook")) return jsonOk(true);
      if (String(url).includes("getUpdates")) {
        updates += 1;
        if (updates === 1) {
          return jsonOk([
            { update_id: 1, message: { chat: { id: 123 }, text: "hi" } },
          ]);
        }
        await hangUntilAbort(init);
      }
      if (String(url).includes("sendMessage")) {
        return jsonOk({ message_id: 1 });
      }
      return jsonOk([]);
    };
    const ctx = boot(apiFetch, async () => ({ turnId: "t1", status: "ok" }), reply);
    stops.push(
      startTelegramPoller(
        ctx,
        parseTelegramConfig({
          token: "tok",
          allowedChatIds: [123],
          poll: true,
          workspaceRoot: "/ws",
          apiFetch,
        }),
      ),
    );
    await vi.waitFor(() => {
      expect(calls.some((c) => c.url.endsWith("/sendMessage"))).toBe(true);
    });
    const sent = calls.find((c) => c.url.endsWith("/sendMessage"));
    expect((sent?.body as { text: string }).text.length).toBe(4096);
  });

  it("skips inbound when session is awaiting_action", async () => {
    const inboundTexts: string[] = [];
    let updates = 0;
    const apiFetch: typeof fetch = async (url, init) => {
      if (String(url).includes("deleteWebhook")) return jsonOk(true);
      if (String(url).includes("getUpdates")) {
        updates += 1;
        if (updates === 1) {
          return jsonOk([
            { update_id: 1, message: { chat: { id: 123 }, text: "hi" } },
          ]);
        }
        await hangUntilAbort(init);
      }
      return jsonOk([]);
    };
    const ctx = boot(apiFetch, async (input: RunTurnInput) => {
      inboundTexts.push(input.text);
      return { turnId: "t1", status: "ok" };
    });
    const session = ctx.require<SessionStore>("sessions").getOrCreate("telegram:123");
    session.append({ type: "turn/start", turnId: "t1" });
    session.append({
      type: "a2ui/surface",
      turnId: "t1",
      surfaceId: "main",
      wait: true,
      messages: [
        { version: "v0.9", createSurface: { surfaceId: "main", catalogId: "flintloom:a2ui:core" } },
      ],
    });
    stops.push(
      startTelegramPoller(
        ctx,
        parseTelegramConfig({
          token: "tok",
          allowedChatIds: [123],
          poll: true,
          workspaceRoot: "/ws",
          apiFetch,
        }),
      ),
    );
    await vi.waitFor(() => {
      expect(updates).toBeGreaterThan(1);
    });
    expect(inboundTexts).toEqual([]);
  });

  it("transcribes allowlisted voice messages when asr is configured", async () => {
    const calls: Call[] = [];
    const inboundTexts: string[] = [];
    let updates = 0;
    const apiFetch: typeof fetch = async (url, init) => {
      const body =
        init?.body === undefined ? undefined : JSON.parse(String(init.body));
      calls.push({ url: String(url), body });
      if (String(url).includes("deleteWebhook")) {
        return jsonOk(true);
      }
      if (String(url).includes("getUpdates")) {
        updates += 1;
        if (updates === 1) {
          return jsonOk([
            {
              update_id: 20,
              message: { chat: { id: 123 }, voice: { file_id: "voice-1" } },
            },
          ]);
        }
        await hangUntilAbort(init);
      }
      if (String(url).includes("getFile")) {
        return jsonOk({ file_path: "voice/file.ogg" });
      }
      if (String(url).includes("/file/bot")) {
        return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      }
      if (String(url).includes("sendMessage")) {
        return jsonOk({ message_id: 1 });
      }
      return jsonOk([]);
    };
    const ctx = boot(apiFetch, async (input: RunTurnInput) => {
      inboundTexts.push(input.text);
      input.session.append({ type: "turn/start", turnId: "t-voice" });
      input.session.append({ type: "user/message", text: input.text });
      return { turnId: "t-voice", status: "ok" };
    });
    ctx.require<ModelRegistry>("models").registerAsr("fake", {
      async transcribe(input) {
        expect(input.mimeType).toBe("audio/ogg");
        expect(input.audio).toEqual(new Uint8Array([1, 2, 3]));
        return "hello from voice";
      },
    });
    ctx.require<ModelRegistry>("models").setDefault("asr", "fake");
    stops.push(
      startTelegramPoller(
        ctx,
        parseTelegramConfig({
          token: "tok",
          allowedChatIds: [123],
          poll: true,
          workspaceRoot: "/ws",
          apiFetch,
        }),
      ),
    );
    await vi.waitFor(() => {
      expect(inboundTexts).toEqual(["hello from voice"]);
    });
    const sent = calls.find((c) => c.url.endsWith("/sendMessage"));
    expect(sent?.body).toEqual({ chat_id: 123, text: "reply-text" });
  });

  it("retries deleteWebhook and never getUpdates while it fails", async () => {
    vi.useFakeTimers();
    const calls: Call[] = [];
    const apiFetch: typeof fetch = async (url, init) => {
      const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
      calls.push({ url: String(url), body });
      if (String(url).includes("deleteWebhook")) {
        return new Response(JSON.stringify({ ok: false }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return jsonOk([]);
    };
    const ctx = boot(apiFetch, async () => ({ turnId: "t1", status: "ok" }));
    stops.push(
      startTelegramPoller(
        ctx,
        parseTelegramConfig({
          token: "tok",
          allowedChatIds: [123],
          poll: true,
          workspaceRoot: "/ws",
          apiFetch,
        }),
      ),
    );
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.every((c) => c.url.includes("deleteWebhook"))).toBe(true);
    expect(calls.some((c) => c.url.includes("getUpdates"))).toBe(false);
  });
});
