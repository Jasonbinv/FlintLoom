import { realpathSync } from "node:fs";
import { dirname, relative } from "node:path";
import { stat } from "node:fs/promises";
import type { KnowledgeService } from "@flintloom/knowledge";
import { isHiddenRelPath, resolveInside, type ToolDefinition } from "@flintloom/tools";
import { convertDocument } from "./convert.ts";
import { compareDocuments } from "./compare.ts";
import { editMarkdown } from "./edit.ts";
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
  "missing path",
  "missing old",
  "missing a",
  "missing b",
  "bad new",
  "not unique",
  "hidden",
  "not found",
  "not a file",
  "bad source",
  "bad out",
  "missing parent",
  "too large",
  "unreadable",
  "empty text",
  "encrypted",
  "unsupported type",
]);

function strArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function newArg(args: Record<string, unknown>): string | undefined {
  if (!Object.hasOwn(args, "new") || args.new === undefined) {
    return "";
  }
  return typeof args.new === "string" ? args.new : undefined;
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
        await generateDocument(absSource, absOut);
        return JSON.stringify({
          status: "ok",
          source: sourceRel,
          out: outRel,
          format,
        });
      } catch (err) {
        return failFromError(err);
      }
    },
  };
}

export function createDocEditTool(): ToolDefinition {
  return {
    name: "doc_edit",
    description:
      "Replace one exact substring in a workspace markdown file. Pass path, old, and new; new may be empty to delete. old must occur exactly once after newline normalization. Do not use this to rewrite a whole file (use fs) or to edit pdf/docx (convert to md first).",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        old: { type: "string" },
        new: { type: "string" },
      },
      required: ["path", "old"],
    },
    async execute(args, exec) {
      if (exec.signal.aborted) {
        return "aborted";
      }
      const inputPath = strArg(args, "path");
      if (inputPath === undefined) {
        return "failed: missing path";
      }
      const old = strArg(args, "old");
      if (old === undefined) {
        return "failed: missing old";
      }
      const replacement = newArg(args);
      if (replacement === undefined) {
        return "failed: bad new";
      }
      const absPath = resolveInside(exec.workspaceRoot, inputPath);
      const realRoot = realpathSync.native(exec.workspaceRoot);
      const pathRel = relative(realRoot, absPath).replaceAll("\\", "/");
      if (isHiddenRelPath(inputPath) || isHiddenRelPath(pathRel)) {
        return "failed: hidden";
      }
      let st;
      try {
        st = await stat(absPath);
      } catch (err) {
        if (isNotFound(err)) {
          return "failed: not found";
        }
        return failFromError(err);
      }
      if (!st.isFile()) {
        return "failed: not a file";
      }
      if (st.size > GENERATE_MAX_BYTES) {
        return "failed: too large";
      }
      try {
        const result = await editMarkdown(absPath, old, replacement);
        return JSON.stringify({
          status: "ok",
          path: pathRel,
          replaced: result.replaced,
        });
      } catch (err) {
        return failFromError(err);
      }
    },
  };
}

export function createDocCompareTool(): ToolDefinition {
  return {
    name: "doc_compare",
    description:
      "Compare two workspace documents by parsing each to markdown and returning a unified diff. Pass a and b. Identical files return identical true and an empty diff. Do not use this to rewrite files (use doc_edit or fs) or to summarize (use doc_summarize later).",
    parameters: {
      type: "object",
      properties: {
        a: { type: "string" },
        b: { type: "string" },
      },
      required: ["a", "b"],
    },
    async execute(args, exec) {
      if (exec.signal.aborted) {
        return "aborted";
      }
      const a = strArg(args, "a");
      if (a === undefined) {
        return "failed: missing a";
      }
      const b = strArg(args, "b");
      if (b === undefined) {
        return "failed: missing b";
      }
      const absA = resolveInside(exec.workspaceRoot, a);
      const absB = resolveInside(exec.workspaceRoot, b);
      const realRoot = realpathSync.native(exec.workspaceRoot);
      const aRel = relative(realRoot, absA).replaceAll("\\", "/");
      const bRel = relative(realRoot, absB).replaceAll("\\", "/");
      if (
        isHiddenRelPath(a) ||
        isHiddenRelPath(b) ||
        isHiddenRelPath(aRel) ||
        isHiddenRelPath(bRel)
      ) {
        return "failed: hidden";
      }
      for (const absPath of [absA, absB]) {
        let st;
        try {
          st = await stat(absPath);
        } catch (err) {
          if (isNotFound(err)) {
            return "failed: not found";
          }
          return failFromError(err);
        }
        if (!st.isFile()) {
          return "failed: not a file";
        }
        if (st.size > GENERATE_MAX_BYTES) {
          return "failed: too large";
        }
      }
      try {
        const result = await compareDocuments(absA, absB, aRel, bRel);
        return JSON.stringify({
          status: "ok",
          a: aRel,
          b: bRel,
          identical: result.identical,
          diff: result.diff,
        });
      } catch (err) {
        return failFromError(err);
      }
    },
  };
}

export function createDocConvertTool(): ToolDefinition {
  return {
    name: "doc_convert",
    description:
      "Convert a workspace document (md, html, pdf, docx, pptx, or xlsx) to md, html, docx, or pdf. Pass source and out; format is the out extension. pptx and xlsx cannot be out. Do not use this to generate from scratch; write markdown first or use doc_generate for md sources if you prefer.",
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
        const result = await convertDocument(absSource, absOut);
        return JSON.stringify({
          status: "ok",
          source: sourceRel,
          out: outRel,
          from: result.from,
          format: result.format,
          loss: result.loss,
        });
      } catch (err) {
        return failFromError(err);
      }
    },
  };
}
