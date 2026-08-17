import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Context, FlintPlugin } from "@flintloom/kernel";
import {
  resolveInside,
  type ToolDefinition,
  type ToolRegistry,
} from "@flintloom/tools";

const READ_LIMIT = 200_000;

export function createFsTool(): ToolDefinition {
  return {
    name: "fs",
    description: "Read, write, or list files within the workspace.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["read", "write", "list"] },
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["action", "path"],
    },
    async execute(args, exec) {
      const action = String(args.action);
      const inputPath = String(args.path);
      const resolvedPath = resolveInside(exec.workspaceRoot, inputPath);

      switch (action) {
        case "read": {
          const content = await readFile(resolvedPath, "utf8");
          if (content.length > READ_LIMIT) {
            return (
              content.slice(0, READ_LIMIT) +
              `\n\n[truncated: output exceeded ${READ_LIMIT} characters]`
            );
          }
          return content;
        }
        case "write": {
          await mkdir(path.dirname(resolvedPath), { recursive: true });
          await writeFile(resolvedPath, String(args.content ?? ""), "utf8");
          return `Wrote ${inputPath}`;
        }
        case "list": {
          const entries = await readdir(resolvedPath);
          return entries.join("\n");
        }
        default:
          throw new Error(`Unknown fs action: ${action}`);
      }
    },
  };
}

const plugin: FlintPlugin = {
  name: "@flintloom/fs",
  apply(ctx: Context) {
    const tools = ctx.require<ToolRegistry>("tools");
    ctx.effect(tools.register(createFsTool()));
  },
};

export default plugin;
