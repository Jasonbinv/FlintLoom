import { homedir } from "node:os";
import type { Context, FlintPlugin } from "@flintloom/kernel";
import type { ToolRegistry } from "@flintloom/tools";
import { parseSkillMarkdown } from "./parse.ts";
import { lookupSkill, scanSkills } from "./scan.ts";
import { createSkillTool } from "./tool.ts";

function homeDirFromConfig(config: Record<string, unknown>): string {
  return typeof config.homeDir === "string" && config.homeDir.length > 0
    ? config.homeDir
    : homedir();
}

const plugin: FlintPlugin = {
  name: "@flintloom/skill",
  apply(ctx: Context, config: Record<string, unknown>) {
    const tools = ctx.require<ToolRegistry>("tools");
    ctx.effect(tools.register(createSkillTool({ homeDir: homeDirFromConfig(config) })));
  },
};

export type { SkillLookup, SkillRecord, SkillSource } from "./parse.ts";
export { parseSkillMarkdown } from "./parse.ts";
export { lookupSkill, scanSkills } from "./scan.ts";
export { createSkillTool } from "./tool.ts";
export default plugin;
