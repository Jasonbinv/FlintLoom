import type { Context, FlintPlugin } from "@flintloom/kernel";
import type { ChannelRegistry } from "@flintloom/channel";
import { createDiscordAdapter } from "./adapter.ts";
import { parseDiscordConfig } from "./config.ts";
import { startDiscordPoller } from "./poller.ts";

const plugin: FlintPlugin = {
  name: "@flintloom/channel-discord",
  apply(ctx: Context, config: Record<string, unknown>) {
    const token = config.token;
    if (typeof token !== "string" || token.length === 0) {
      return;
    }
    const channels = ctx.require<ChannelRegistry>("channels");
    ctx.require("sessions");
    ctx.require("loop");
    const parsed = parseDiscordConfig(config);
    ctx.effect(channels.register("discord", createDiscordAdapter(ctx, parsed)));
    if (parsed.poll) {
      ctx.require<Set<string>>("turnBusy");
      ctx.effect(startDiscordPoller(ctx, parsed));
    }
  },
};

export default plugin;
