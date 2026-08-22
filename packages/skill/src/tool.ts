import { isPluginId } from "@flintloom/kernel";
import type { ToolDefinition } from "@flintloom/tools";
import { lookupSkill, scanSkills } from "./scan.ts";

export function createSkillTool(opts: { homeDir: string }): ToolDefinition {
  return {
    name: "skill",
    description:
      "List or read local skills. Use action list, or action read with id.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "read"] },
        id: { type: "string" },
      },
      required: ["action"],
    },
    async execute(args, exec) {
      if (exec.signal.aborted) {
        return "aborted";
      }
      if (typeof args.action !== "string") {
        return "failed: missing action";
      }
      if (args.action === "list") {
        const skills = scanSkills({
          homeDir: opts.homeDir,
          workspaceRoot: exec.workspaceRoot,
        }).map(({ body: _body, ...rest }) => rest);
        return JSON.stringify({ skills });
      }
      if (args.action !== "read") {
        return "failed: unknown action";
      }
      if (typeof args.id !== "string" || !isPluginId(args.id)) {
        return "failed: missing id";
      }
      const looked = lookupSkill({
        homeDir: opts.homeDir,
        workspaceRoot: exec.workspaceRoot,
        id: args.id,
      });
      if (!looked.ok) {
        return `failed: ${looked.reason}`;
      }
      return JSON.stringify(looked.record);
    },
  };
}
