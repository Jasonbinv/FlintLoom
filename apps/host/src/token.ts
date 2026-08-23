import { randomBytes } from "node:crypto";
import {
  readCredentialsStore,
  writeCredentialsStore,
} from "./credentials.ts";

export function readCredentials(homeDir: string): Record<string, unknown> {
  return readCredentialsStore(homeDir) as Record<string, unknown>;
}

export function loadOrCreateToken(homeDir: string): string {
  const store = readCredentialsStore(homeDir);
  if (typeof store.hostToken === "string" && store.hostToken.length > 0) {
    return store.hostToken;
  }

  const hostToken = randomBytes(24).toString("hex");
  writeCredentialsStore(homeDir, { ...store, hostToken });
  return hostToken;
}
