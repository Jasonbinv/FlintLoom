import { realpathSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";
import { detectType, parse } from "@flintloom/docforge";
import { isHiddenRelPath, resolveInside } from "@flintloom/tools";

export type FileEntry = { name: string; type: "file" | "dir" };
export type FileList = { path: string; entries: FileEntry[] };
export type FilePreview = {
  path: string;
  kind: "markdown" | "text" | "failed";
  text: string;
};

const READ_LIMIT = 200_000;
const TRUNCATE_SUFFIX = `\n\n[truncated: output exceeded ${READ_LIMIT} characters]`;

const DOCFORGE_TYPES = new Set([
  "md",
  "html",
  "pdf",
  "docx",
  "pptx",
  "xlsx",
]);

const TEXT_EXTS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".yml",
  ".yaml",
  ".css",
  ".txt",
  ".xml",
  ".svg",
  ".sh",
  ".bash",
  ".ps1",
  ".bat",
  ".toml",
  ".sql",
  ".py",
  ".rs",
  ".go",
  ".java",
  ".kt",
  ".mdx",
  ".map",
  ".lock",
]);

function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "ENOENT"
  );
}

export function relFromWorkspace(workspaceRoot: string, absPath: string): string {
  const rootReal = realpathSync.native(workspaceRoot);
  return relative(rootReal, absPath).replaceAll("\\", "/");
}

export function normalizeRelPath(relPath: string | null): string | undefined {
  if (relPath === null || relPath === "") {
    return undefined;
  }
  let normalized = relPath.replaceAll("\\", "/");
  while (normalized.startsWith("/")) {
    normalized = normalized.slice(1);
  }
  while (normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  if (normalized === "") {
    return undefined;
  }
  return normalized;
}

function truncateText(content: string): string {
  if (content.length > READ_LIMIT) {
    return content.slice(0, READ_LIMIT) + TRUNCATE_SUFFIX;
  }
  return content;
}

function fileNameOf(relPath: string): string {
  const parts = relPath.replaceAll("\\", "/").split("/");
  return parts[parts.length - 1] ?? relPath;
}

function isTextPreviewCandidate(fileName: string): boolean {
  const ext = extname(fileName).toLowerCase();
  // `.env.example` is the hide-rule exception and must be previewable as text
  // even though Node reports extname as `.example`.
  if (fileName === ".env.example") {
    return true;
  }
  return TEXT_EXTS.has(ext) || ext === "";
}

export async function listWorkspaceFiles(
  workspaceRoot: string,
  relPath: string,
): Promise<"not_found" | "not_directory" | "hidden" | FileList> {
  if (isHiddenRelPath(relPath)) {
    return "hidden";
  }

  const absPath = resolveInside(workspaceRoot, relPath);
  if (isHiddenRelPath(relFromWorkspace(workspaceRoot, absPath))) {
    return "hidden";
  }

  let st;
  try {
    st = await stat(absPath);
  } catch (err) {
    if (isNotFound(err)) {
      return "not_found";
    }
    throw err;
  }

  if (!st.isDirectory()) {
    return "not_directory";
  }

  const names = await readdir(absPath);
  const entries: FileEntry[] = [];
  for (const name of names) {
    if (isHiddenRelPath(name)) {
      continue;
    }
    const childStat = await stat(join(absPath, name));
    entries.push({
      name,
      type: childStat.isDirectory() ? "dir" : "file",
    });
  }

  entries.sort((a, b) => a.name.localeCompare(b.name, "en"));
  return { path: relPath, entries };
}

export async function previewWorkspaceFile(
  workspaceRoot: string,
  relPath: string,
): Promise<"not_found" | FilePreview> {
  if (isHiddenRelPath(relPath)) {
    return { path: relPath, kind: "failed", text: "failed: hidden" };
  }

  const absPath = resolveInside(workspaceRoot, relPath);
  if (isHiddenRelPath(relFromWorkspace(workspaceRoot, absPath))) {
    return { path: relPath, kind: "failed", text: "failed: hidden" };
  }

  let st;
  try {
    st = await stat(absPath);
  } catch (err) {
    if (isNotFound(err)) {
      return "not_found";
    }
    throw err;
  }

  if (st.isDirectory()) {
    return { path: relPath, kind: "failed", text: "failed: not a file" };
  }

  const bytes = await readFile(absPath);
  const docType = detectType(absPath, bytes);

  if (DOCFORGE_TYPES.has(docType)) {
    const text = await parse(absPath);
    if (text.startsWith("failed:")) {
      return { path: relPath, kind: "failed", text };
    }
    return { path: relPath, kind: "markdown", text };
  }

  const fileName = fileNameOf(relPath);
  if (isTextPreviewCandidate(fileName) && !bytes.includes(0)) {
    return {
      path: relPath,
      kind: "text",
      text: truncateText(bytes.toString("utf8")),
    };
  }

  return {
    path: relPath,
    kind: "failed",
    text: "failed: unsupported type",
  };
}
