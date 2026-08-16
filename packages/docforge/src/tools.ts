import { resolveInside, type ToolDefinition } from "@flintloom/tools";
import { parse } from "./parse.ts";
import { probe } from "./probe.ts";
import type { ProbeResult } from "./types.ts";

function encodeProbe(result: ProbeResult): string {
  const ordered: Record<string, unknown> = { type: result.type };
  if (result.pages !== undefined) {
    ordered.pages = result.pages;
  }
  ordered.parseable = result.parseable;
  if (result.reason !== undefined) {
    ordered.reason = result.reason;
  }
  return JSON.stringify(ordered);
}

function pathArg(args: Record<string, unknown>): string | undefined {
  return typeof args.path === "string" && args.path.length > 0
    ? args.path
    : undefined;
}

export function createDocProbeTool(): ToolDefinition {
  return {
    name: "doc_probe",
    description:
      "Detect a workspace document type and whether it can be parsed. Use before doc_parse.",
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
      const absPath = resolveInside(exec.workspaceRoot, inputPath);
      return encodeProbe(await probe(absPath));
    },
  };
}

export function createDocParseTool(): ToolDefinition {
  return {
    name: "doc_parse",
    description:
      "Parse pdf, docx, pptx, xlsx, html, or markdown in the workspace into markdown. Do not use fs to read those binaries.",
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
      const absPath = resolveInside(exec.workspaceRoot, inputPath);
      return parse(absPath);
    },
  };
}
