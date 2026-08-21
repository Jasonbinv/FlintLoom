import type { Context, FlintPlugin } from "@flintloom/kernel";
import type { ChannelRegistry } from "@flintloom/channel";
import { createTelegramAdapter } from "./adapter.ts";
import { parseTelegramConfig } from "./config.ts";
import { startTelegramPoller } from "./poller.ts";

const plugin: FlintPlugin = {
  name: "@flintloom/channel-telegram",
  apply(ctx: Context, config: Record<string, unknown>) {
    const channels = ctx.require<ChannelRegistry>("channels");
    ctx.require("sessions");
    ctx.require("loop");
    const parsed = parseTelegramConfig(config);
    ctx.effect(channels.register("telegram", createTelegramAdapter(ctx)));
    if (parsed.poll) {
      ctx.require<Set<string>>("turnBusy");
      ctx.effect(startTelegramPoller(ctx, parsed));
    }
  },
};

export default plugin;
