import { parse } from "yaml";

export const SKILL_MAX_BYTES = 800_000;
export const SKILL_MAX_CHARS = 200_000;
export const SKILL_NAME_MAX = 80;
export const SKILL_DESCRIPTION_MAX = 500;

export type SkillSource = "home" | "workspace";
export type SkillRecord = {
  id: string;
  name: string;
  description: string;
  source: SkillSource;
  body: string;
};
export type SkillLookup =
  | { ok: true; record: SkillRecord }
  | { ok: false; reason: "not found" | "bad skill" | "too large" };

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function asTrimmedString(value: unknown, max: number): string {
  if (typeof value !== "string") {
    throw new Error("bad skill");
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) {
    throw new Error("bad skill");
  }
  return trimmed;
}

export function parseSkillMarkdown(raw: string): {
  name: string;
  description: string;
  body: string;
} {
  const text = raw.startsWith("\uFEFF") ? raw.slice(1) : raw;
  const match = FENCE.exec(text);
  if (match === null || match[1] === undefined) {
    throw new Error("bad skill");
  }
  const header: unknown = parse(match[1]);
  if (header === null || typeof header !== "object" || Array.isArray(header)) {
    throw new Error("bad skill");
  }
  const rec = header as Record<string, unknown>;
  const name = asTrimmedString(rec.name, SKILL_NAME_MAX);
  const description = asTrimmedString(rec.description, SKILL_DESCRIPTION_MAX);
  const body = text.slice(match[0].length);
  if (body.length > SKILL_MAX_CHARS) {
    throw new Error("too large");
  }
  return { name, description, body };
}
