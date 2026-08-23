import type { Context, FlintPlugin } from "@flintloom/kernel";
import type { ChannelRegistry } from "@flintloom/channel";
import { createSlackAdapter } from "./adapter.ts";
import { parseSlackConfig } from "./config.ts";
import { startSlackPoller } from "./poller.ts";

const plugin: FlintPlugin = {
  name: "@flintloom/channel-slack",
  apply(ctx: Context, config: Record<string, unknown>) {
    const token = config.token;
    if (typeof token !== "string" || token.length === 0) {
      return;
    }
    const channels = ctx.require<ChannelRegistry>("channels");
    ctx.require("sessions");
    ctx.require("loop");
    const parsed = parseSlackConfig(config);
    ctx.effect(channels.register("slack", createSlackAdapter(ctx, parsed)));
    if (parsed.poll) {
      ctx.require<Set<string>>("turnBusy");
      ctx.effect(startSlackPoller(ctx, parsed));
    }
  },
};

export default plugin;
