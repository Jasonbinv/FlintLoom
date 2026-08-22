import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { isPluginId } from "@flintloom/kernel";
import {
  isHiddenRelPath,
  resolveInside,
  WorkspaceEscapeError,
} from "@flintloom/tools";
import {
  SKILL_MAX_BYTES,
  parseSkillMarkdown,
} from "./parse.ts";
import type { SkillLookup, SkillRecord, SkillSource } from "./parse.ts";

export type { SkillLookup, SkillRecord, SkillSource } from "./parse.ts";

function readRecord(
  absPath: string,
  id: string,
  source: SkillSource,
): SkillLookup {
  if (!existsSync(absPath)) {
    return { ok: false, reason: "not found" };
  }
  const st = statSync(absPath);
  if (!st.isFile() || st.size > SKILL_MAX_BYTES) {
    return { ok: false, reason: st.isFile() ? "too large" : "bad skill" };
  }
  try {
    const parsed = parseSkillMarkdown(readFileSync(absPath, "utf8"));
    return {
      ok: true,
      record: { id, source, name: parsed.name, description: parsed.description, body: parsed.body },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    return { ok: false, reason: message === "too large" ? "too large" : "bad skill" };
  }
}

function workspaceAbs(workspaceRoot: string, id: string): string | undefined {
  try {
    return resolveInside(workspaceRoot, `skills/${id}/SKILL.md`);
  } catch (err) {
    if (err instanceof WorkspaceEscapeError) {
      return undefined;
    }
    throw err;
  }
}

function childDirs(root: string): string[] {
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    return [];
  }
  return readdirSync(root).filter((name) => {
    if (!isPluginId(name) || isHiddenRelPath(name)) {
      return false;
    }
    return statSync(join(root, name)).isDirectory();
  });
}

export function lookupSkill(input: {
  homeDir: string;
  workspaceRoot: string;
  id: string;
}): SkillLookup {
  const wsDir = join(input.workspaceRoot, "skills", input.id);
  if (existsSync(wsDir) && statSync(wsDir).isDirectory()) {
    const abs = workspaceAbs(input.workspaceRoot, input.id);
    if (abs === undefined) {
      return { ok: false, reason: "not found" };
    }
    return readRecord(abs, input.id, "workspace");
  }
  return readRecord(
    join(input.homeDir, ".flintloom", "skills", input.id, "SKILL.md"),
    input.id,
    "home",
  );
}

export function scanSkills(input: {
  homeDir: string;
  workspaceRoot: string;
}): SkillRecord[] {
  const map = new Map<string, SkillRecord>();
  const homeRoot = join(input.homeDir, ".flintloom", "skills");
  for (const id of childDirs(homeRoot)) {
    const looked = readRecord(join(homeRoot, id, "SKILL.md"), id, "home");
    if (looked.ok) {
      map.set(id, looked.record);
    }
  }
  const wsRoot = join(input.workspaceRoot, "skills");
  for (const id of childDirs(wsRoot)) {
    map.delete(id);
    const looked = lookupSkill({ ...input, id });
    if (looked.ok) {
      map.set(id, looked.record);
    }
  }
  return [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
}
