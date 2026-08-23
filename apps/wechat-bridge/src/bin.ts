#!/usr/bin/env node
import { createBridgeFromConfig } from "./bridge.ts";
import { loadBridgeConfig } from "./config.ts";
import { startHttpTransport } from "./transports/http.ts";
import { startWechatyTransport } from "./transports/wechaty.ts";

async function main(): Promise<void> {
  const config = loadBridgeConfig();
  const bridge = createBridgeFromConfig({
    hookUrl: config.hookUrl,
    hostToken: config.hostToken,
    allowedFrom: config.allowedFrom,
  });

  console.log(`[wechat-bridge] mode=${config.mode} hook=${config.hookUrl}`);

  let close: (() => Promise<void>) | undefined;
  if (config.mode === "wechaty") {
    close = await startWechatyTransport(config, bridge);
  } else {
    const http = await startHttpTransport({
      host: config.httpHost,
      port: config.httpPort,
      secret: config.httpSecret,
      bridge,
    });
    close = http.close;
  }

  const shutdown = async () => {
    console.log("[wechat-bridge] shutting down…");
    if (close) {
      await close();
    }
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((err) => {
  console.error("[wechat-bridge] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
