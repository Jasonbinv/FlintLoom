import { execFileSync } from "node:child_process";
import { platform } from "node:os";

export type PickFolderResult =
  | { status: "picked"; path: string }
  | { status: "canceled" };

export function isPickFolderSupported(): boolean {
  const os = platform();
  return os === "win32" || os === "darwin" || os === "linux";
}

/** Build PowerShell script for FolderBrowserDialog (testable). */
export function buildWindowsPickFolderScript(initialPath?: string): string {
  const lines = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$d = New-Object System.Windows.Forms.FolderBrowserDialog",
    "$d.Description = '选择 FlintLoom 工作区目录（需包含 flintloom.yml）'",
  ];
  if (initialPath !== undefined && initialPath.trim().length > 0) {
    const escaped = initialPath.replace(/'/g, "''");
    lines.push(`$d.SelectedPath = '${escaped}'`);
  }
  lines.push(
    "if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {",
    "  Write-Output $d.SelectedPath",
    "}",
  );
  return lines.join("\n");
}

function pickFolderWindows(initialPath?: string): PickFolderResult {
  try {
    const out = execFileSync(
      "powershell",
      ["-NoProfile", "-STA", "-Command", buildWindowsPickFolderScript(initialPath)],
      { encoding: "utf8" },
    ).trim();
    if (out.length === 0) {
      return { status: "canceled" };
    }
    return { status: "picked", path: out };
  } catch {
    return { status: "canceled" };
  }
}

function pickFolderMac(initialPath?: string): PickFolderResult {
  const args = [
    "-e",
    'POSIX path of (choose folder with prompt "选择 FlintLoom 工作区目录")',
  ];
  try {
    const out = execFileSync("osascript", args, { encoding: "utf8" }).trim();
    if (out.length === 0) {
      return { status: "canceled" };
    }
    return { status: "picked", path: out };
  } catch {
    if (initialPath !== undefined && initialPath.trim().length > 0) {
      // osascript choose folder does not accept default path; ignore.
    }
    return { status: "canceled" };
  }
}

function pickFolderLinux(initialPath?: string): PickFolderResult {
  const args = ["--file-selection", "--directory", "--title=选择 FlintLoom 工作区目录"];
  if (initialPath !== undefined && initialPath.trim().length > 0) {
    args.push(`--filename=${initialPath}`);
  }
  try {
    const out = execFileSync("zenity", args, { encoding: "utf8" }).trim();
    if (out.length === 0) {
      return { status: "canceled" };
    }
    return { status: "picked", path: out };
  } catch {
    return { status: "canceled" };
  }
}

export function pickFolderNative(initialPath?: string): PickFolderResult {
  const os = platform();
  if (os === "win32") {
    return pickFolderWindows(initialPath);
  }
  if (os === "darwin") {
    return pickFolderMac(initialPath);
  }
  if (os === "linux") {
    return pickFolderLinux(initialPath);
  }
  return { status: "canceled" };
}
