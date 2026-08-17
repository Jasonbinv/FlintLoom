import { homedir } from "node:os";
import { createServer } from "vite";
import { loadOrCreateToken, startHost } from "@flintloom/host";
import { ensureHost } from "../apps/desktop/src/probe.ts";

const token = loadOrCreateToken(homedir());
await ensureHost({
  origin: "http://127.0.0.1:7331",
  token,
  start: async () => {
    await startHost({
      workspaceRoot: process.cwd(),
      homeDir: homedir(),
      port: 7331,
    });
  },
});
const vite = await createServer({
  configFile: "apps/desktop/vite.config.ts",
  root: "apps/desktop",
});
await vite.listen();
vite.printUrls();
