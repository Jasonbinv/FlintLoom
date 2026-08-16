import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function credentialsPath(homeDir: string): string {
  return join(homeDir, ".flintloom", "credentials");
}

export function readCredentials(homeDir: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(credentialsPath(homeDir), "utf8"));
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // missing or invalid credentials file
  }
  return {};
}

export function loadOrCreateToken(homeDir: string): string {
  const existing = readCredentials(homeDir);
  const current = existing.hostToken;
  if (typeof current === "string" && current.length > 0) {
    return current;
  }

  const hostToken = randomBytes(24).toString("hex");
  mkdirSync(join(homeDir, ".flintloom"), { recursive: true });
  writeFileSync(
    credentialsPath(homeDir),
    JSON.stringify({ ...existing, hostToken }),
    "utf8",
  );
  return hostToken;
}
