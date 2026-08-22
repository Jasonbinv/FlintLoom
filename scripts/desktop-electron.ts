import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { loadOrCreateToken, startHost } from "@flintloom/host";
import { ensureHost } from "../apps/desktop/src/probe.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const electronDir = join(root, "apps/electron");
const require = createRequire(import.meta.url);
const electronBin = require(join(electronDir, "node_modules/electron/index.js")) as string;

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
  configFile: join(root, "apps/desktop/vite.config.ts"),
  root: join(root, "apps/desktop"),
});
await vite.listen();
vite.printUrls();

const desktopUrl = "http://127.0.0.1:5173";
const child = spawn(electronBin, [electronDir], {
  env: { ...process.env, FLINT_DESKTOP_URL: desktopUrl },
  stdio: "inherit",
});

child.on("exit", (code) => {
  vite.close();
  process.exit(code ?? 0);
});

process.on("SIGINT", () => {
  child.kill("SIGINT");
});
