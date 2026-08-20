import type { Context, FlintPlugin } from "@flintloom/kernel";
import { createChannelRegistry } from "./registry.ts";

const plugin: FlintPlugin = {
  name: "@flintloom/channel",
  apply(ctx: Context) {
    ctx.provide("channels", createChannelRegistry());
  },
};

export default plugin;
