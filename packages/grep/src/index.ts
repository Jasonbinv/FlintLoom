import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { Context, FlintPlugin } from "@flintloom/kernel";
import {
  resolveInside,
  WorkspaceEscapeError,
  type ToolDefinition,
  type ToolRegistry,
} from "@flintloom/tools";

const MAX_HITS = 200;

const SKIP_DIRS = new Set(["node_modules", ".git"]);

async function walkAndGrep(
  workspaceRoot: string,
  rootDir: string,
  regex: RegExp,
  hits: string[],
): Promise<void> {
  if (hits.length >= MAX_HITS) {
    return;
  }

  let entries;
  try {
    entries = await readdir(rootDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (hits.length >= MAX_HITS) {
      return;
    }

    const fullPath = path.join(rootDir, entry.name);
    const relativePath = path.relative(workspaceRoot, fullPath);

    let safePath: string;
    try {
      safePath = resolveInside(workspaceRoot, relativePath);
    } catch (error) {
      if (error instanceof WorkspaceEscapeError) {
        continue;
      }
      throw error;
    }

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }
      await walkAndGrep(workspaceRoot, safePath, regex, hits);
      continue;
    }

    let entryStat;
    try {
      entryStat = await stat(safePath);
    } catch {
      continue;
    }

    if (entryStat.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }
      await walkAndGrep(workspaceRoot, safePath, regex, hits);
      continue;
    }

    if (!entryStat.isFile()) {
      continue;
    }

    let content: string;
    try {
      content = await readFile(safePath, "utf8");
    } catch {
      continue;
    }

    if (content.includes("\0")) {
      continue;
    }

    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (hits.length >= MAX_HITS) {
        return;
      }
      if (regex.test(lines[i]!)) {
        hits.push(`${safePath}:${i + 1}:${lines[i]}`);
      }
    }
  }
}

export function createGrepTool(): ToolDefinition {
  return {
    name: "grep",
    description: "Search workspace files for a regular expression pattern.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        path: { type: "string" },
      },
      required: ["pattern"],
    },
    async execute(args, exec) {
      const pattern = String(args.pattern);
      const regex = new RegExp(pattern);

      const startPath =
        typeof args.path === "string" && args.path.length > 0
          ? resolveInside(exec.workspaceRoot, args.path)
          : await realpath(exec.workspaceRoot);

      const hits: string[] = [];
      await walkAndGrep(exec.workspaceRoot, startPath, regex, hits);
      return hits.join("\n");
    },
  };
}

const plugin: FlintPlugin = {
  name: "@flintloom/grep",
  apply(ctx: Context) {
    const tools = ctx.require<ToolRegistry>("tools");
    ctx.effect(tools.register(createGrepTool()));
  },
};

export default plugin;
