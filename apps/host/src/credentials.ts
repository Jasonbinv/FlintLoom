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

export function resolveLayeredString(
  envKey: string,
  fileEnv: Record<string, string>,
  credValue: string | undefined,
): { value: string | undefined; source: CredentialSource } {
  const fromProcess = process.env[envKey];
  if (typeof fromProcess === "string" && fromProcess.length > 0) {
    return { value: fromProcess, source: "env" };
  }
  const fromFile = fileEnv[envKey];
  if (typeof fromFile === "string" && fromFile.length > 0) {
    return { value: fromFile, source: "env" };
  }
  if (typeof credValue === "string" && credValue.length > 0) {
    return { value: credValue, source: "credentials" };
  }
  return { value: undefined, source: "none" };
}

export function isLocalLlmBaseUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
}
