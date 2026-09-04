import type { Context, FlintPlugin } from "@flintloom/kernel";
import type { ChannelRegistry } from "@flintloom/channel";
import { createFeishuAdapter } from "./adapter.ts";
import { parseFeishuConfig } from "./config.ts";
import { startFeishuPoller } from "./poller.ts";

const plugin: FlintPlugin = {
  name: "@flintloom/channel-feishu",
  apply(ctx: Context, config: Record<string, unknown>) {
    const appId = config.appId;
    const appSecret =
      typeof config.appSecret === "string"
        ? config.appSecret
        : typeof config.token === "string"
          ? config.token
          : "";
    if (typeof appId !== "string" || appId.length === 0 || appSecret.length === 0) {
      return;
    }
    const channels = ctx.require<ChannelRegistry>("channels");
    ctx.require("sessions");
    ctx.require("loop");
    const parsed = parseFeishuConfig(config);
    ctx.effect(channels.register("feishu", createFeishuAdapter(ctx, parsed)));
    if (parsed.poll) {
      ctx.require<Set<string>>("turnBusy");
      ctx.effect(startFeishuPoller(ctx, parsed));
    }
  },
};

export default plugin;
