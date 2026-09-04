import { describe, expect, it } from "vitest";
import {
  ELECTRON_USER_DATA_MARKER,
  electronPidsFromProcessList,
  parsePsPidArgs,
  parseWindowsListeningPids,
  parseWmicProcessList,
  pidsMatchingMarker,
  windowsElectronShellPsCommand,
} from "../../../scripts/kill-ports.ts";

describe("parseWindowsListeningPids", () => {
  it("extracts LISTENING pid for the requested port", () => {
    const sample = `
  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       17280
  TCP    127.0.0.1:5173         127.0.0.1:49988        ESTABLISHED     17280
  TCP    127.0.0.1:7331         0.0.0.0:0              LISTENING       17280
  TCP    127.0.0.1:7340         0.0.0.0:0              LISTENING       17140
`.trim();

    expect(parseWindowsListeningPids(sample, 5173)).toEqual([17280]);
    expect(parseWindowsListeningPids(sample, 7331)).toEqual([17280]);
    expect(parseWindowsListeningPids(sample, 7340)).toEqual([17140]);
    expect(parseWindowsListeningPids(sample, 3000)).toEqual([]);
  });
});

describe("electron shell process matching", () => {
  it("parses WMIC LIST blocks and matches flintloom-electron", () => {
    const output = `
CommandLine=C:\\electron.exe --user-data-dir=C:\\Temp\\flintloom-electron
ProcessId=4321

CommandLine=C:\\other.exe --user-data-dir=C:\\Temp\\other-app
ProcessId=99

CommandLine=
ProcessId=2
`.trim();
    const processes = parseWmicProcessList(output);
    expect(pidsMatchingMarker(processes, ELECTRON_USER_DATA_MARKER)).toEqual([
      4321,
    ]);
    expect(pidsMatchingMarker(processes, "other-app")).toEqual([99]);
  });

  it("parses ps pid args lines", () => {
    const output = `
  1111 /usr/bin/electron /app --user-data-dir=/tmp/flintloom-electron
  2222 /usr/bin/electron /other --user-data-dir=/tmp/other
`.trim();
    expect(
      pidsMatchingMarker(parsePsPidArgs(output), ELECTRON_USER_DATA_MARKER),
    ).toEqual([1111]);
  });

  it("does not match bare electron.exe without the user-data marker", () => {
    expect(
      pidsMatchingMarker(
        [{ pid: 8, commandLine: "C:\\\\electron.exe" }],
        ELECTRON_USER_DATA_MARKER,
      ),
    ).toEqual([]);
  });

  it("prefers PowerShell CIM matches over WMIC output", () => {
    const wmicText = `
CommandLine=C:\\electron.exe --user-data-dir=C:\\Temp\\flintloom-electron
ProcessId=4321
`.trim();
    const psText = `5555 C:\\electron.exe --user-data-dir=C:\\Temp\\flintloom-electron`;
    expect(
      electronPidsFromProcessList(
        wmicText,
        psText,
        ELECTRON_USER_DATA_MARKER,
      ),
    ).toEqual([5555]);
  });

  it("falls back to WMIC when PowerShell has no matching pids", () => {
    const wmicText = `
CommandLine=C:\\electron.exe --user-data-dir=C:\\Temp\\flintloom-electron
ProcessId=4321
`.trim();
    expect(
      electronPidsFromProcessList(wmicText, "", ELECTRON_USER_DATA_MARKER),
    ).toEqual([4321]);
  });

  it("filters CommandLine inside PowerShell instead of dumping the process table", () => {
    const cmd = windowsElectronShellPsCommand(ELECTRON_USER_DATA_MARKER);
    expect(cmd).toContain("CommandLine -like '*flintloom-electron*'");
    expect(cmd.toLowerCase()).not.toMatch(/processname\s+-eq\s+'electron\.exe'/);
  });
});
