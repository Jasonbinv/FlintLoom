import type { Context, FlintPlugin } from "@flintloom/kernel";
import type { ChannelRegistry } from "@flintloom/channel";
import { createWecomAdapter } from "./adapter.ts";
import { parseWecomConfig, type WecomConfig } from "./config.ts";

const plugin: FlintPlugin = {
  name: "@flintloom/channel-wecom",
  apply(ctx: Context, config: Record<string, unknown>) {
    const corpId =
      typeof config.corpId === "string"
        ? config.corpId
        : typeof config.appId === "string"
          ? config.appId
          : "";
    const corpSecret =
      typeof config.corpSecret === "string"
        ? config.corpSecret
        : typeof config.token === "string"
          ? config.token
          : "";
    if (corpId.length === 0 || corpSecret.length === 0) {
      return;
    }
    const channels = ctx.require<ChannelRegistry>("channels");
    ctx.require("sessions");
    ctx.require("loop");
    const parsed = parseWecomConfig(config);
    ctx.provide<WecomConfig>("wecomConfig", parsed);
    ctx.effect(channels.register("wecom", createWecomAdapter(ctx, parsed)));
  },
};

export default plugin;
