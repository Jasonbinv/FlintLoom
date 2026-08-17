import type { Context, FlintPlugin } from "@flintloom/kernel";
import { SessionStore } from "./store.ts";

const plugin: FlintPlugin = {
  name: "@flintloom/session",
  apply(ctx: Context) {
    ctx.provide("sessions", new SessionStore());
  },
};

export default plugin;
