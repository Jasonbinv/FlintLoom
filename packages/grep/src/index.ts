import { readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { resolveInside, type ToolDefinition } from "@flintloom/tools";

const MAX_HITS = 200;

const SKIP_DIRS = new Set(["node_modules", ".git"]);

async function walkAndGrep(
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

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }
      await walkAndGrep(fullPath, regex, hits);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    let content: string;
    try {
      content = await readFile(fullPath, "utf8");
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
        hits.push(`${fullPath}:${i + 1}:${lines[i]}`);
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
      await walkAndGrep(startPath, regex, hits);
      return hits.join("\n");
    },
  };
}
