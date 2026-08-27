import type { Context, FlintPlugin } from "@flintloom/kernel";
import { SessionStore } from "./store.ts";

type SessionPluginConfig = {
  sessionsDir?: string;
};

const plugin: FlintPlugin = {
  name: "@flintloom/session",
  apply(ctx: Context, config?: SessionPluginConfig) {
    ctx.provide(
      "sessions",
      new SessionStore(
        config?.sessionsDir !== undefined
          ? { sessionsDir: config.sessionsDir }
          : undefined,
      ),
    );
  },
};

export default plugin;
