import { realpathSync } from "node:fs";
import { dirname, relative } from "node:path";
import { stat } from "node:fs/promises";
import type { KnowledgeService } from "@flintloom/knowledge";
import { isHiddenRelPath, resolveInside, type ToolDefinition } from "@flintloom/tools";
import {
  GENERATE_MAX_BYTES,
  formatFromOutRelPath,
  generateDocument,
} from "./generate.ts";
import { ingestWorkspaceFile } from "./ingest.ts";
import { parse } from "./parse.ts";
import { probe } from "./probe.ts";
import type { ProbeResult } from "./types.ts";

const FAIL_REASONS = new Set([
  "missing source",
  "missing out",
  "hidden",
  "not found",
  "not a file",
  "bad source",
  "bad out",
  "missing parent",
  "too large",
  "unreadable",
]);

function strArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "ENOENT"
  );
}

function failFromError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (FAIL_REASONS.has(message)) {
    return `failed: ${message}`;
  }
  return "failed: unreadable";
}

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

export function createDocIngestTool(kb: KnowledgeService): ToolDefinition {
  return {
    name: "doc_ingest",
    description:
      "Parse a workspace document and ingest it into the local knowledge base.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    async execute(args, exec) {
      const outcome = await ingestWorkspaceFile(
        kb,
        exec.workspaceRoot,
        pathArg(args),
        exec.signal,
      );
      switch (outcome.kind) {
        case "aborted":
          return "aborted";
        case "missing_path":
          return "failed: missing path";
        case "hidden":
          return "failed: hidden";
        case "not_found":
          return "failed: not found";
        case "not_a_file":
          return "failed: not a file";
        case "written": {
          const payload: Record<string, unknown> = {
            status: outcome.record.status,
            id: outcome.record.id,
            path: outcome.record.path,
            title: outcome.record.title,
          };
          if (outcome.record.failReason !== undefined) {
            payload.failReason = outcome.record.failReason;
          }
          return JSON.stringify(payload);
        }
      }
    },
  };
}

export function createDocGenerateTool(): ToolDefinition {
  return {
    name: "doc_generate",
    description:
      "Write a workspace markdown file to md, html, docx, or pdf. Pass source and out; format is the out extension. Write the markdown with fs first. Do not use this to parse binaries.",
    parameters: {
      type: "object",
      properties: {
        source: { type: "string" },
        out: { type: "string" },
      },
      required: ["source", "out"],
    },
    async execute(args, exec) {
      if (exec.signal.aborted) {
        return "aborted";
      }
      const source = strArg(args, "source");
      if (source === undefined) {
        return "failed: missing source";
      }
      const out = strArg(args, "out");
      if (out === undefined) {
        return "failed: missing out";
      }
      const absSource = resolveInside(exec.workspaceRoot, source);
      const absOut = resolveInside(exec.workspaceRoot, out);
      const realRoot = realpathSync.native(exec.workspaceRoot);
      const sourceRel = relative(realRoot, absSource).replaceAll("\\", "/");
      const outRel = relative(realRoot, absOut).replaceAll("\\", "/");
      if (
        isHiddenRelPath(source) ||
        isHiddenRelPath(out) ||
        isHiddenRelPath(sourceRel) ||
        isHiddenRelPath(outRel)
      ) {
        return "failed: hidden";
      }
      const format = formatFromOutRelPath(outRel);
      if (format === undefined) {
        return "failed: bad out";
      }
      let sourceStat;
      try {
        sourceStat = await stat(absSource);
      } catch (err) {
        if (isNotFound(err)) {
          return "failed: not found";
        }
        return failFromError(err);
      }
      if (!sourceStat.isFile()) {
        return "failed: not a file";
      }
      if (sourceStat.size > GENERATE_MAX_BYTES) {
        return "failed: too large";
      }
      try {
        const parent = await stat(dirname(absOut));
        if (!parent.isDirectory()) {
          return "failed: missing parent";
        }
      } catch (err) {
        if (isNotFound(err)) {
          return "failed: missing parent";
        }
        return failFromError(err);
      }
      try {
        const outStat = await stat(absOut);
        if (!outStat.isFile()) {
          return "failed: not a file";
        }
      } catch (err) {
        if (!isNotFound(err)) {
          return failFromError(err);
        }
      }
      try {
        const result = await generateDocument(absSource, absOut);
        return JSON.stringify({
          status: "ok",
          source: sourceRel,
          out: outRel,
          format: result.format,
        });
      } catch (err) {
        return failFromError(err);
      }
    },
  };
}
