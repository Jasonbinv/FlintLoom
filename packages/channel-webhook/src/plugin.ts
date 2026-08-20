import type { Context, FlintPlugin } from "@flintloom/kernel";
import type { ChannelRegistry } from "@flintloom/channel";
import { createWebhookAdapter } from "./adapter.ts";

const plugin: FlintPlugin = {
  name: "@flintloom/channel-webhook",
  apply(ctx: Context) {
    const channels = ctx.require<ChannelRegistry>("channels");
    ctx.require("sessions");
    ctx.require("loop");
    ctx.effect(channels.register("webhook", createWebhookAdapter(ctx)));
  },
};

export default plugin;
