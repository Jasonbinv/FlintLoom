import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DESKTOP_PORTS,
  killElectronShell,
  killPorts,
  sleep,
  WECHAT_BRIDGE_PORTS,
} from "./kill-ports.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const tsxCli = require.resolve("tsx/cli");

type Target = "desktop" | "desktop:app" | "wechat-bridge";

const TARGETS: Record<
  Target,
  { ports: readonly number[]; script: string; label: string }
> = {
  desktop: {
    ports: DESKTOP_PORTS,
    script: "scripts/desktop-dev.ts",
    label: "desktop",
  },
  "desktop:app": {
    ports: DESKTOP_PORTS,
    script: "scripts/desktop-electron.ts",
    label: "desktop:app",
  },
  "wechat-bridge": {
    ports: WECHAT_BRIDGE_PORTS,
    script: "apps/wechat-bridge/src/bin.ts",
    label: "wechat-bridge",
  },
};

function usage(): void {
  console.error(
    "Usage: tsx scripts/restart.ts <desktop|desktop:app|wechat-bridge>",
  );
}

function buildChildEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const cwd = process.cwd();
  if (
    !env.FLINT_WORKSPACE_ROOT?.trim() &&
    existsSync(join(cwd, "flintloom.yml"))
  ) {
    env.FLINT_WORKSPACE_ROOT = cwd;
    console.log(`[restart] workspace: ${cwd}`);
  }
  return env;
}

const target = process.argv[2] as Target | undefined;
if (!target || !(target in TARGETS)) {
  usage();
  process.exit(1);
}

const config = TARGETS[target];
const killed = killPorts(config.ports);
const electronKilled =
  target === "desktop" || target === "desktop:app" ? killElectronShell() : [];
const allKilled = [...killed, ...electronKilled];
if (allKilled.length > 0) {
  console.log(`[restart] stopped PIDs: ${allKilled.join(", ")}`);
  await sleep(400);
} else {
  console.log(`[restart] no listeners on ports: ${config.ports.join(", ")}`);
}

console.log(`[restart] starting ${config.label}…`);

const child = spawn(
  process.execPath,
  [tsxCli, join(root, config.script)],
  {
    cwd: root,
    stdio: "inherit",
    env: buildChildEnv(),
  },
);

child.on("exit", (code) => {
  process.exit(code ?? 0);
});

process.on("SIGINT", () => {
  child.kill("SIGINT");
});

process.on("SIGTERM", () => {
  child.kill("SIGTERM");
});
