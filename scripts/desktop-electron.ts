import { homedir, tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { loadOrCreateToken, startHost } from "@flintloom/host";
import { ensureHost } from "../apps/desktop/src/probe.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const electronDir = join(root, "apps/electron");

async function waitForHttpOk(url: string, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        return;
      }
    } catch {
      // Vite / host still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`desktop not ready: ${url}`);
}

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
await waitForHttpOk(desktopUrl);

const require = createRequire(import.meta.url);
const electronBin = require(join(electronDir, "node_modules/electron/index.js")) as string;
const userDataDir = join(tmpdir(), "flintloom-electron");

const child = spawn(
  electronBin,
  [electronDir, `--user-data-dir=${userDataDir}`],
  {
    env: { ...process.env, FLINT_DESKTOP_URL: desktopUrl },
    stdio: "inherit",
  },
);

child.on("exit", (code) => {
  vite.close();
  process.exit(code ?? 0);
});

process.on("SIGINT", () => {
  child.kill("SIGINT");
});
