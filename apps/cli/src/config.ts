import type { CredentialSlotId } from "@flintloom/host";

const SLOT_IDS = new Set<CredentialSlotId>([
  "chat",
  "media",
  "guard",
  "telegram",
  "discord",
  "slack",
  "feishu",
  "wecom",
]);

const CONFIG_KEYS = new Set([
  "apiKey",
  "baseUrl",
  "model",
  "allowedChatIds",
  "appId",
  "agentId",
  "callbackToken",
  "encodingAesKey",
]);

export type CliConfigGetCommand = {
  kind: "config-get";
  workspace: string;
  slotId?: CredentialSlotId;
};

export type CliConfigSetCommand = {
  kind: "config-set";
  workspace: string;
  slotId: CredentialSlotId;
  field: string;
  value: string;
};

export type CliConfigCommand = CliConfigGetCommand | CliConfigSetCommand;

function parseSlotId(raw: string): CredentialSlotId {
  if (!SLOT_IDS.has(raw as CredentialSlotId)) {
    throw new Error("slot");
  }
  return raw as CredentialSlotId;
}

export function parseConfigArgv(rest: string[], workspace: string): CliConfigCommand {
  if (rest[1] === "get") {
    const slotRaw = rest[2];
    if (slotRaw === undefined) {
      return { kind: "config-get", workspace };
    }
    return { kind: "config-get", workspace, slotId: parseSlotId(slotRaw) };
  }
  if (rest[1] === "set") {
    const slotId = parseSlotId(rest[2] ?? "");
    const field = rest[3];
    if (field === undefined || !CONFIG_KEYS.has(field)) {
      throw new Error("field");
    }
    if (rest.length < 4) {
      throw new Error("value");
    }
    const value = rest.slice(4).join(" ");
    return { kind: "config-set", workspace, slotId, field, value };
  }
  throw new Error("config");
}
