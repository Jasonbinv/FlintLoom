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

export const ELECTRON_USER_DATA_MARKER = "flintloom-electron";

export function parseWmicProcessList(
  output: string,
): { pid: number; commandLine: string }[] {
  const result: { pid: number; commandLine: string }[] = [];
  for (const block of output.split(/\r?\n\s*\r?\n/)) {
    let pid: number | undefined;
    let commandLine = "";
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("ProcessId=")) {
        pid = Number.parseInt(line.slice("ProcessId=".length).trim(), 10);
      } else if (line.startsWith("CommandLine=")) {
        commandLine = line.slice("CommandLine=".length);
      }
    }
    if (pid !== undefined && Number.isFinite(pid) && pid > 0) {
      result.push({ pid, commandLine });
    }
  }
  return result;
}

export function parsePsPidArgs(
  output: string,
): { pid: number; commandLine: string }[] {
  const result: { pid: number; commandLine: string }[] = [];
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    const match = trimmed.match(/^(\d+)\s+(.*)$/);
    if (!match) continue;
    result.push({ pid: Number.parseInt(match[1], 10), commandLine: match[2] });
  }
  return result;
}

export function pidsMatchingMarker(
  processes: ReadonlyArray<{ pid: number; commandLine: string }>,
  marker: string,
): number[] {
  const pids = new Set<number>();
  for (const proc of processes) {
    if (proc.commandLine.includes(marker)) pids.add(proc.pid);
  }
  return [...pids];
}

const EXEC_MAX_BUFFER = 4 * 1024 * 1024;

/** Prefer PowerShell CIM / ps pid-args; if none, parse WMIC matches. */
export function electronPidsFromProcessList(
  wmicText: string,
  psText: string,
  marker: string,
): number[] {
  const psPids = pidsMatchingMarker(parsePsPidArgs(psText), marker);
  if (psPids.length > 0) return psPids;
  return pidsMatchingMarker(parseWmicProcessList(wmicText), marker);
}

/** PowerShell lists only processes whose CommandLine contains the marker. */
export function windowsElectronShellPsCommand(marker: string): string {
  return `powershell.exe -NoProfile -NonInteractive -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${marker}*' } | ForEach-Object { if ($_.ProcessId -and $_.CommandLine) { '{0} {1}' -f $_.ProcessId, $_.CommandLine } }"`;
}

function findElectronShellPids(): number[] {
  try {
    if (platform() === "win32") {
      let psText = "";
      try {
        psText = execSync(windowsElectronShellPsCommand(ELECTRON_USER_DATA_MARKER), {
          encoding: "utf8",
          windowsHide: true,
          maxBuffer: EXEC_MAX_BUFFER,
        });
      } catch {
        psText = "";
      }
      let wmicText = "";
      if (
        pidsMatchingMarker(parsePsPidArgs(psText), ELECTRON_USER_DATA_MARKER)
          .length === 0
      ) {
        try {
          wmicText = execSync(
            "wmic process get ProcessId,CommandLine /FORMAT:LIST",
            { encoding: "utf8", windowsHide: true, maxBuffer: EXEC_MAX_BUFFER },
          );
        } catch {
          wmicText = "";
        }
      }
      return electronPidsFromProcessList(
        wmicText,
        psText,
        ELECTRON_USER_DATA_MARKER,
      );
    }
    const output = execSync("ps -ax -o pid=,args=", {
      encoding: "utf8",
      maxBuffer: EXEC_MAX_BUFFER,
    });
    return pidsMatchingMarker(parsePsPidArgs(output), ELECTRON_USER_DATA_MARKER);
  } catch {
    return [];
  }
}

function killPidTree(pid: number): boolean {
  try {
    if (platform() === "win32") {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
    } else {
      process.kill(pid, "SIGTERM");
    }
    return true;
  } catch {
    return false;
  }
}

/** Stop FlintLoom Electron processes (command line contains flintloom-electron). */
export function killElectronShell(): number[] {
  const killed = new Set<number>();
  const currentPid = process.pid;
  for (const pid of findElectronShellPids()) {
    if (pid === currentPid || killed.has(pid)) continue;
    if (killPidTree(pid)) killed.add(pid);
  }
  return [...killed];
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
