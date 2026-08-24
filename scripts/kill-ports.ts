import { execSync } from "node:child_process";
import { platform } from "node:os";

export const DESKTOP_PORTS = [5173, 7331] as const;
export const WECHAT_BRIDGE_PORTS = [7340] as const;
export const ALL_SERVICE_PORTS = [
  ...DESKTOP_PORTS,
  ...WECHAT_BRIDGE_PORTS,
] as const;

/** Parse Windows `netstat -ano` lines and return PIDs listening on `port`. */
export function parseWindowsListeningPids(output: string, port: number): number[] {
  const pids = new Set<number>();
  const needle = `:${port}`;
  for (const line of output.split(/\r?\n/)) {
    if (!line.includes(needle) || !line.includes("LISTENING")) {
      continue;
    }
    const parts = line.trim().split(/\s+/);
    const pid = Number.parseInt(parts.at(-1) ?? "", 10);
    if (Number.isFinite(pid) && pid > 0) {
      pids.add(pid);
    }
  }
  return [...pids];
}

function killPid(pid: number): boolean {
  try {
    if (platform() === "win32") {
      execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
    } else {
      process.kill(pid, "SIGTERM");
    }
    return true;
  } catch {
    return false;
  }
}

function findListeningPids(port: number): number[] {
  if (platform() === "win32") {
    try {
      const output = execSync("netstat -ano", { encoding: "utf8" });
      return parseWindowsListeningPids(output, port);
    } catch {
      return [];
    }
  }

  try {
    const output = execSync(`lsof -tiTCP:${port} -sTCP:LISTEN`, {
      encoding: "utf8",
    });
    return output
      .split(/\r?\n/)
      .map((line) => Number.parseInt(line.trim(), 10))
      .filter((pid) => Number.isFinite(pid) && pid > 0);
  } catch {
    return [];
  }
}

/** Stop processes listening on the given ports. Returns killed PIDs. */
export function killPorts(ports: readonly number[]): number[] {
  const killed = new Set<number>();
  const currentPid = process.pid;

  for (const port of ports) {
    for (const pid of findListeningPids(port)) {
      if (pid === currentPid || killed.has(pid)) {
        continue;
      }
      if (killPid(pid)) {
        killed.add(pid);
      }
    }
  }

  return [...killed];
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
