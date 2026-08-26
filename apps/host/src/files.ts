import { realpathSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { detectType, parse, buildDocument, formatFromOutRelPath, GENERATE_MAX_CHARS } from "@flintloom/docforge";
import {
  isInfographicRelPath,
  parseDocument,
  renderSvg,
} from "@flintloom/infographic";
import { isHiddenRelPath, resolveInside } from "@flintloom/tools";

export type FileEntry = { name: string; type: "file" | "dir" };
export type FileList = { path: string; entries: FileEntry[] };
export type FilePreview = {
  path: string;
  kind:
    | "markdown"
    | "text"
    | "svg"
    | "spreadsheet"
    | "pdf"
    | "docx"
    | "pptx"
    | "audio"
    | "video"
    | "failed";
  text: string;
};

export const FILE_RAW_MAX_BYTES = 30 * 1024 * 1024;
export const FILE_MEDIA_MAX_BYTES = 512 * 1024 * 1024;
export const FILE_MAX_DOCX_PREVIEW_BYTES = 20 * 1024 * 1024;
export const FILE_MAX_PPTX_PREVIEW_BYTES = 50 * 1024 * 1024;

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

function isAlreadyExists(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "EEXIST"
  );
}

export type FileMutationResult =
  | "ok"
  | "not_found"
  | "exists"
  | "invalid"
  | "hidden";

function isInvalidPathSegment(name: string): boolean {
  if (name.length === 0) {
    return true;
  }
  return /[\\/:*?"<>|]/.test(name);
}

function hasInvalidRelPath(relPath: string): boolean {
  const parts = relPath.replaceAll("\\", "/").split("/");
  const segments = parts.filter((part) => part.length > 0 && part !== ".");
  if (segments.length === 0) {
    return true;
  }
  return segments.some(isInvalidPathSegment);
}

async function pathKind(
  absPath: string,
): Promise<"missing" | "file" | "dir"> {
  let st;
  try {
    st = await stat(absPath);
  } catch (err) {
    if (isNotFound(err)) {
      return "missing";
    }
    throw err;
  }
  return st.isDirectory() ? "dir" : "file";
}

function mutableRelPathError(relPath: string): FileMutationResult | undefined {
  if (hasInvalidRelPath(relPath) || relPath === ".") {
    return "invalid";
  }
  if (isHiddenRelPath(relPath)) {
    return "hidden";
  }
  return undefined;
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

function isSpreadsheetFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return (
    lower.endsWith(".xlsx") ||
    lower.endsWith(".xls") ||
    lower.endsWith(".csv")
  );
}

function isPdfFileName(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(".pdf");
}

function isWordFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith(".docx") || lower.endsWith(".doc");
}

function isPptxFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith(".pptx") || lower.endsWith(".ppt");
}

const AUDIO_EXTS = new Set([".mp3", ".wav", ".ogg", ".flac", ".aac", ".m4a"]);
const VIDEO_EXTS = new Set([".mp4", ".webm", ".mov", ".avi", ".mkv"]);

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".aac": "audio/aac",
  ".m4a": "audio/mp4",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".mkv": "video/x-matroska",
};

export function mediaPreviewKind(fileName: string): "audio" | "video" | undefined {
  const ext = extname(fileName).toLowerCase();
  if (AUDIO_EXTS.has(ext)) return "audio";
  if (VIDEO_EXTS.has(ext)) return "video";
  return undefined;
}

export function contentTypeForFileName(fileName: string): string {
  const ext = extname(fileName).toLowerCase();
  return CONTENT_TYPE_BY_EXT[ext] ?? "application/octet-stream";
}

export type ParsedByteRange =
  | { kind: "none" }
  | { kind: "unsatisfiable" }
  | { kind: "range"; start: number; end: number };

export function parseByteRangeHeader(
  header: string | undefined,
  size: number,
): ParsedByteRange {
  if (!header) {
    return { kind: "none" };
  }
  const trimmed = header.trim();
  if (trimmed.length === 0 || trimmed.includes(",")) {
    return { kind: "none" };
  }
  const match = /^bytes=(\d*)-(\d*)$/i.exec(trimmed);
  if (!match) {
    return { kind: "none" };
  }
  const startRaw = match[1] ?? "";
  const endRaw = match[2] ?? "";
  if (startRaw === "" && endRaw === "") {
    return { kind: "none" };
  }

  if (startRaw === "") {
    const suffix = Number(endRaw);
    if (!Number.isSafeInteger(suffix) || suffix <= 0 || size === 0) {
      return { kind: "unsatisfiable" };
    }
    return { kind: "range", start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(startRaw);
  if (!Number.isSafeInteger(start) || start < 0) {
    return { kind: "none" };
  }
  if (start >= size) {
    return { kind: "unsatisfiable" };
  }

  if (endRaw === "") {
    return { kind: "range", start, end: size - 1 };
  }
  const end = Number(endRaw);
  if (!Number.isSafeInteger(end) || end < start) {
    return { kind: "none" };
  }
  return { kind: "range", start, end: Math.min(end, size - 1) };
}

function officePreviewKind(fileName: string): FilePreview["kind"] | undefined {
  if (isPdfFileName(fileName)) return "pdf";
  if (isWordFileName(fileName)) return "docx";
  if (isPptxFileName(fileName)) return "pptx";
  return undefined;
}

function officePreviewMaxBytes(fileName: string): number {
  if (isPptxFileName(fileName)) return FILE_MAX_PPTX_PREVIEW_BYTES;
  if (isWordFileName(fileName)) return FILE_MAX_DOCX_PREVIEW_BYTES;
  return FILE_RAW_MAX_BYTES;
}

export async function resolveWorkspaceReadableFile(
  workspaceRoot: string,
  relPath: string,
): Promise<"not_found" | { absPath: string; size: number; fileName: string }> {
  if (isHiddenRelPath(relPath)) {
    return "not_found";
  }

  const absPath = resolveInside(workspaceRoot, relPath);
  if (isHiddenRelPath(relFromWorkspace(workspaceRoot, absPath))) {
    return "not_found";
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

  if (!st.isFile()) {
    return "not_found";
  }
  return { absPath, size: st.size, fileName: fileNameOf(relPath) };
}

export function rawFileMaxBytes(fileName: string): number {
  return mediaPreviewKind(fileName) ? FILE_MEDIA_MAX_BYTES : FILE_RAW_MAX_BYTES;
}

export async function readWorkspaceFileBytes(
  workspaceRoot: string,
  relPath: string,
): Promise<"not_found" | "too_large" | Buffer> {
  const resolved = await resolveWorkspaceReadableFile(workspaceRoot, relPath);
  if (resolved === "not_found") {
    return "not_found";
  }
  if (resolved.size > rawFileMaxBytes(resolved.fileName)) {
    return "too_large";
  }

  return await readFile(resolved.absPath);
}

export async function writeWorkspaceFileBytes(
  workspaceRoot: string,
  relPath: string,
  bytes: Uint8Array,
): Promise<"not_found" | "too_large" | "ok"> {
  if (isHiddenRelPath(relPath)) {
    return "not_found";
  }

  const absPath = resolveInside(workspaceRoot, relPath);
  if (isHiddenRelPath(relFromWorkspace(workspaceRoot, absPath))) {
    return "not_found";
  }

  if (bytes.byteLength > FILE_RAW_MAX_BYTES) {
    return "too_large";
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

  if (!st.isFile()) {
    return "not_found";
  }

  await writeFile(absPath, bytes);
  return "ok";
}

export async function readWorkspaceFileMarkdown(
  workspaceRoot: string,
  relPath: string,
): Promise<"not_found" | "too_large" | "unsupported" | string> {
  if (isHiddenRelPath(relPath)) {
    return "not_found";
  }

  const absPath = resolveInside(workspaceRoot, relPath);
  if (isHiddenRelPath(relFromWorkspace(workspaceRoot, absPath))) {
    return "not_found";
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

  if (!st.isFile()) {
    return "not_found";
  }
  if (st.size > FILE_RAW_MAX_BYTES) {
    return "too_large";
  }

  const fileName = fileNameOf(relPath);
  const officeKind = officePreviewKind(fileName);
  if (!officeKind) {
    return "unsupported";
  }

  const text = await parse(absPath);
  if (text.startsWith("failed:")) {
    return "unsupported";
  }
  return truncateText(text);
}

export async function writeWorkspaceFileFromMarkdown(
  workspaceRoot: string,
  relPath: string,
  markdown: string,
): Promise<"not_found" | "too_large" | "unsupported" | "ok"> {
  if (isHiddenRelPath(relPath)) {
    return "not_found";
  }

  const absPath = resolveInside(workspaceRoot, relPath);
  if (isHiddenRelPath(relFromWorkspace(workspaceRoot, absPath))) {
    return "not_found";
  }

  const format = formatFromOutRelPath(relPath);
  if (!format || format === "md" || format === "html") {
    return "unsupported";
  }

  if (markdown.length > GENERATE_MAX_CHARS) {
    return "too_large";
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

  if (!st.isFile()) {
    return "not_found";
  }

  const bytes = await buildDocument(format, markdown);
  if (bytes.byteLength > FILE_RAW_MAX_BYTES) {
    return "too_large";
  }

  await writeFile(absPath, bytes);
  return "ok";
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

  const fileName = fileNameOf(relPath);
  if (isSpreadsheetFileName(fileName)) {
    if (st.size > FILE_RAW_MAX_BYTES) {
      return { path: relPath, kind: "failed", text: "failed: too large" };
    }
    return { path: relPath, kind: "spreadsheet", text: "" };
  }

  const mediaKind = mediaPreviewKind(fileName);
  if (mediaKind) {
    if (st.size > FILE_MEDIA_MAX_BYTES) {
      return { path: relPath, kind: "failed", text: "failed: too large" };
    }
    return { path: relPath, kind: mediaKind, text: "" };
  }

  const officeKind = officePreviewKind(fileName);
  if (officeKind) {
    if (st.size > officePreviewMaxBytes(fileName)) {
      return { path: relPath, kind: "failed", text: "failed: too large" };
    }
    return { path: relPath, kind: officeKind, text: "" };
  }

  if (isInfographicRelPath(relPath)) {
    if (st.size > 65536) {
      return { path: relPath, kind: "failed", text: "failed: too large" };
    }
    const raw = (await readFile(absPath)).toString("utf8");
    try {
      return { path: relPath, kind: "svg", text: renderSvg(parseDocument(raw)) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { path: relPath, kind: "failed", text: `failed: ${message}` };
    }
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

export async function createWorkspaceDirectory(
  workspaceRoot: string,
  relPath: string,
): Promise<FileMutationResult> {
  const prepared = mutableRelPathError(relPath);
  if (prepared) {
    return prepared;
  }

  const absPath = resolveInside(workspaceRoot, relPath);
  if (isHiddenRelPath(relFromWorkspace(workspaceRoot, absPath))) {
    return "hidden";
  }

  try {
    await mkdir(absPath);
  } catch (err) {
    if (isAlreadyExists(err)) {
      return "exists";
    }
    if (isNotFound(err)) {
      return "not_found";
    }
    throw err;
  }
  return "ok";
}

export async function createWorkspaceFile(
  workspaceRoot: string,
  relPath: string,
): Promise<FileMutationResult> {
  const prepared = mutableRelPathError(relPath);
  if (prepared) {
    return prepared;
  }

  const absPath = resolveInside(workspaceRoot, relPath);
  if (isHiddenRelPath(relFromWorkspace(workspaceRoot, absPath))) {
    return "hidden";
  }

  try {
    await writeFile(absPath, Buffer.alloc(0), { flag: "wx" });
  } catch (err) {
    if (isAlreadyExists(err)) {
      return "exists";
    }
    if (isNotFound(err)) {
      return "not_found";
    }
    throw err;
  }
  return "ok";
}

export async function renameWorkspaceEntry(
  workspaceRoot: string,
  fromRelPath: string,
  toRelPath: string,
): Promise<FileMutationResult> {
  const fromPrepared = mutableRelPathError(fromRelPath);
  if (fromPrepared) {
    return fromPrepared;
  }
  const toPrepared = mutableRelPathError(toRelPath);
  if (toPrepared) {
    return toPrepared;
  }

  const fromAbs = resolveInside(workspaceRoot, fromRelPath);
  const toAbs = resolveInside(workspaceRoot, toRelPath);
  if (
    isHiddenRelPath(relFromWorkspace(workspaceRoot, fromAbs)) ||
    isHiddenRelPath(relFromWorkspace(workspaceRoot, toAbs))
  ) {
    return "hidden";
  }

  const fromKind = await pathKind(fromAbs);
  if (fromKind === "missing") {
    return "not_found";
  }
  const toKind = await pathKind(toAbs);
  if (toKind !== "missing") {
    return "exists";
  }

  const fromNorm = fromAbs.replaceAll("\\", "/").toLowerCase();
  const toNorm = toAbs.replaceAll("\\", "/").toLowerCase();
  if (fromKind === "dir" && toNorm.startsWith(`${fromNorm}/`)) {
    return "invalid";
  }

  try {
    await rename(fromAbs, toAbs);
  } catch (err) {
    if (isNotFound(err)) {
      return "not_found";
    }
    if (isAlreadyExists(err)) {
      return "exists";
    }
    throw err;
  }
  return "ok";
}

export async function deleteWorkspaceEntry(
  workspaceRoot: string,
  relPath: string,
): Promise<FileMutationResult> {
  const prepared = mutableRelPathError(relPath);
  if (prepared) {
    return prepared;
  }

  const absPath = resolveInside(workspaceRoot, relPath);
  if (isHiddenRelPath(relFromWorkspace(workspaceRoot, absPath))) {
    return "hidden";
  }

  const kind = await pathKind(absPath);
  if (kind === "missing") {
    return "not_found";
  }

  try {
    await rm(absPath, { recursive: kind === "dir", force: false });
  } catch (err) {
    if (isNotFound(err)) {
      return "not_found";
    }
    throw err;
  }
  return "ok";
}
