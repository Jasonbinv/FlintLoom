import { homedir, tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type ViteDevServer } from "vite";
import { loadOrCreateToken, startHost } from "@flintloom/host";
import { ensureHost, probeHost } from "../apps/desktop/src/probe.ts";
import {
  logDesktopWorkspace,
  resolveDesktopWorkspace,
} from "./desktop-workspace.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const electronDir = join(root, "apps/electron");
const hostOrigin = "http://127.0.0.1:7331";
const desktopUrl = "http://127.0.0.1:5173";

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

async function isHttpOk(url: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    return res.ok;
  } catch {
    return false;
  }
}

const token = loadOrCreateToken(homedir());
const homeDir = homedir();
const workspaceRoot = resolveDesktopWorkspace();
logDesktopWorkspace(workspaceRoot);

const hostState = await probeHost({ origin: hostOrigin, token });
if (hostState === "foreign") {
  console.error(
    "[desktop:app] port 7331 is in use by another process. Run: pnpm desktop:app:restart",
  );
  process.exit(1);
}

if (hostState === "missing") {
  await ensureHost({
    origin: hostOrigin,
    token,
    start: async () => {
      await startHost({
        workspaceRoot,
        homeDir,
        port: 7331,
      });
    },
  });
} else {
  console.log(`[desktop:app] reusing host at ${hostOrigin}`);
}

let vite: ViteDevServer | undefined;
let ownsVite = false;
if (await isHttpOk(desktopUrl)) {
  console.log(`[desktop:app] reusing dev server at ${desktopUrl}`);
} else {
  vite = await createServer({
    configFile: join(root, "apps/desktop/vite.config.ts"),
    root: join(root, "apps/desktop"),
  });
  await vite.listen();
  vite.printUrls();
  ownsVite = true;
  await waitForHttpOk(desktopUrl);
}

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
  if (ownsVite) {
    void vite?.close();
  }
  process.exit(code ?? 0);
});

process.on("SIGINT", () => {
  child.kill("SIGINT");
});
