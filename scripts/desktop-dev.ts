import { homedir } from "node:os";
import { createServer } from "vite";
import { loadOrCreateToken, startHost } from "@flintloom/host";
import { ensureHost } from "../apps/desktop/src/probe.ts";
import {
  logDesktopWorkspace,
  resolveDesktopWorkspace,
} from "./desktop-workspace.ts";

const token = loadOrCreateToken(homedir());
const homeDir = homedir();
const workspaceRoot = resolveDesktopWorkspace();
logDesktopWorkspace(workspaceRoot);
await ensureHost({
  origin: "http://127.0.0.1:7331",
  token,
  start: async () => {
    await startHost({
      workspaceRoot,
      homeDir,
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
