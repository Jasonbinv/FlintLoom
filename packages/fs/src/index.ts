import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Context, FlintPlugin } from "@flintloom/kernel";
import {
  preferExistingGeneratedRel,
  resolveInside,
  routeGeneratedWriteRel,
  type ToolDefinition,
  type ToolRegistry,
} from "@flintloom/tools";

const READ_LIMIT = 200_000;

export function createFsTool(): ToolDefinition {
  return {
    name: "fs",
    description:
      "Read, write, or list files within the workspace. For this chat, write simple filenames like ket.md; the system places them in the session folder. Writing a file creates that folder; do not use shell mkdir and do not invent dates. Do not dump generated documents in the workspace root or into type folders like docx/ or PPT/. Do not move existing user files such as README.md.",
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
      const routedPath =
        action === "write"
          ? routeGeneratedWriteRel(inputPath, exec.workspaceRoot, exec.generationDir)
          : preferExistingGeneratedRel(inputPath, exec.workspaceRoot, exec.generationDir);
      const resolvedPath = resolveInside(exec.workspaceRoot, routedPath);

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
          return `Wrote ${routedPath}`;
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
