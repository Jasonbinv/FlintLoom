import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type CredentialSlotId = "chat" | "media" | "guard" | "telegram";
export type CredentialSource = "env" | "credentials" | "none";

export type CredentialsStore = {
  hostToken?: string;
  chatApiKey?: string;
  providers?: Record<string, Record<string, string>>;
  channels?: Record<string, Record<string, string>>;
};

export function credentialsPath(homeDir: string): string {
  return join(homeDir, ".flintloom", "credentials");
}

export function normalizeCredentialsStore(raw: CredentialsStore): CredentialsStore {
  const store: CredentialsStore = { ...raw };
  if (
    typeof store.chatApiKey === "string" &&
    store.chatApiKey.length > 0 &&
    store.providers?.chat?.apiKey === undefined
  ) {
    store.providers = {
      ...store.providers,
      chat: { ...store.providers?.chat, apiKey: store.chatApiKey },
    };
  }
  return store;
}

export function readCredentialsStore(homeDir: string): CredentialsStore {
  try {
    const parsed: unknown = JSON.parse(readFileSync(credentialsPath(homeDir), "utf8"));
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return normalizeCredentialsStore(parsed as CredentialsStore);
    }
  } catch {
    // missing or invalid credentials file
  }
  return {};
}

export function writeCredentialsStore(homeDir: string, store: CredentialsStore): void {
  mkdirSync(join(homeDir, ".flintloom"), { recursive: true });
  writeFileSync(credentialsPath(homeDir), JSON.stringify(store), "utf8");
}

export function maskSecret(value: string): string {
  if (value.length <= 8) {
    return "***";
  }
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
