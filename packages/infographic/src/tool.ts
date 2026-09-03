import { realpathSync } from "node:fs";
import { relative } from "node:path";
import { readFile, stat, writeFile } from "node:fs/promises";
import {
  isHiddenRelPath,
  resolveInside,
  type ToolDefinition,
} from "@flintloom/tools";
import { compileInfographic } from "./compile.ts";
import { INFOGRAPHIC_MAX_BYTES, applyOps, parseDocument } from "./document.ts";
import { isInfographicRelPath } from "./path.ts";
import type { InfographicDocument } from "./types.ts";

function pathArg(args: Record<string, unknown>): string | undefined {
  return typeof args.path === "string" && args.path.length > 0
    ? args.path
    : undefined;
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "ENOENT"
  );
}

function failMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return `failed: ${message}`;
}

type Resolved = {
  absPath: string;
  relPath: string;
};

function resolveTarget(
  workspaceRoot: string,
  inputPath: string,
): Resolved | "failed: hidden" | "failed: bad path" {
  const absPath = resolveInside(workspaceRoot, inputPath);
  const realRoot = realpathSync.native(workspaceRoot);
  const relPath = relative(realRoot, absPath).replaceAll("\\", "/");

  if (isHiddenRelPath(inputPath) || isHiddenRelPath(relPath)) {
    return "failed: hidden";
  }
  if (!isInfographicRelPath(relPath)) {
    return "failed: bad path";
  }
  return { absPath, relPath };
}

async function readExistingDoc(
  absPath: string,
): Promise<InfographicDocument | "failed: not found" | "failed: not a file" | "failed: too large" | string> {
  let st;
  try {
    st = await stat(absPath);
  } catch (err) {
    if (isNotFound(err)) {
      return "failed: not found";
    }
    throw err;
  }
  if (!st.isFile()) {
    return "failed: not a file";
  }
  if (st.size > INFOGRAPHIC_MAX_BYTES) {
    return "failed: too large";
  }
  const raw = await readFile(absPath, "utf8");
  try {
    return parseDocument(raw);
  } catch (err) {
    return failMessage(err);
  }
}

export function createInfographicGetTool(): ToolDefinition {
  return {
    name: "infographic_get",
    description:
      "Read a workspace *.infographic.json document as JSON (nodes and edges).",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    async execute(args, exec) {
      if (exec.signal.aborted) {
        return "aborted";
      }
      const inputPath = pathArg(args);
      if (inputPath === undefined) {
        return "failed: missing path";
      }
      const target = resolveTarget(exec.workspaceRoot, inputPath);
      if (typeof target === "string") {
        return target;
      }
      const doc = await readExistingDoc(target.absPath);
      if (typeof doc === "string") {
        return doc;
      }
      return JSON.stringify(doc);
    },
  };
}

export function createInfographicPatchTool(): ToolDefinition {
  return {
    name: "infographic_patch",
    description:
      "Apply ops to a workspace *.infographic.json. Create the file when ops include addNode.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        ops: { type: "array" },
      },
      required: ["path", "ops"],
    },
    async execute(args, exec) {
      if (exec.signal.aborted) {
        return "aborted";
      }
      const inputPath = pathArg(args);
      if (inputPath === undefined) {
        return "failed: missing path";
      }
      if (!("ops" in args)) {
        return "failed: empty ops";
      }
      const target = resolveTarget(exec.workspaceRoot, inputPath);
      if (typeof target === "string") {
        return target;
      }

      let base: InfographicDocument | undefined;
      try {
        const st = await stat(target.absPath);
        if (!st.isFile()) {
          return "failed: not a file";
        }
        if (st.size > INFOGRAPHIC_MAX_BYTES) {
          return "failed: too large";
        }
        const raw = await readFile(target.absPath, "utf8");
        try {
          base = parseDocument(raw);
        } catch (err) {
          return failMessage(err);
        }
      } catch (err) {
        if (isNotFound(err)) {
          const ops = args.ops;
          const hasAddNode =
            Array.isArray(ops) &&
            ops.some(
              (op) =>
                typeof op === "object" &&
                op !== null &&
                "op" in op &&
                (op as { op: unknown }).op === "addNode",
            );
          if (!hasAddNode) {
            return "failed: not found";
          }
          base = { nodes: [], edges: [] };
        } else {
          throw err;
        }
      }

      let doc: InfographicDocument;
      try {
        doc = applyOps(base, args.ops);
      } catch (err) {
        return failMessage(err);
      }

      try {
        await writeFile(target.absPath, JSON.stringify(doc, null, 2) + "\n", "utf8");
      } catch (err) {
        if (isNotFound(err)) {
          return "failed: not found";
        }
        throw err;
      }

      return JSON.stringify({
        status: "ok",
        path: target.relPath,
        nodes: doc.nodes.length,
        edges: doc.edges.length,
      });
    },
  };
}

export function createInfographicRenderTool(): ToolDefinition {
  return {
    name: "infographic_render",
    description:
      "Draw an AntV infographic poster in chat when the user asked for SWOT, steps, mind map, or similar. Pass template plus items[{label, desc?, children?}]. Aliases: steps, timeline, swot, compare, quadrant, mindmap. Do not call a2ui_emit for infographics. Bar/line/pie/radar/heatmap charts use a2ui_emit, not this tool. Optional syntax: a full infographic DSL block. No http(s).",
    parameters: {
      type: "object",
      properties: {
        template: {
          type: "string",
          description:
            "steps, timeline, swot, compare, quadrant, mindmap, or an official list-/compare-/sequence-/hierarchy- name.",
        },
        title: { type: "string" },
        items: {
          type: "array",
          description: "Entries with label and optional desc or children labels.",
        },
        syntax: {
          type: "string",
          description: "Optional full AntV DSL starting with infographic <template>.",
        },
      },
    },
    async execute(args, exec) {
      if (exec.signal.aborted) {
        return "aborted";
      }
      try {
        const syntax = compileInfographic(args);
        return JSON.stringify({ status: "ok", syntax });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `failed: ${message}`;
      }
    },
  };
}
