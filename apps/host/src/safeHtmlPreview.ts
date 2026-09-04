import { randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolveInside, isHiddenRelPath } from "@flintloom/tools";
import {
  normalizeRelPath,
  relFromWorkspace,
} from "./files.ts";

const MAX_HTML_BYTES = 4 * 1024 * 1024;
const TOKEN_TTL_MS = 10 * 60 * 1000;

type TokenEntry = {
  relPath: string;
  workspaceRoot: string;
  expiresAt: number;
};

const tokens = new Map<string, TokenEntry>();

export function isHtmlRelPath(relPath: string): boolean {
  const lower = relPath.toLowerCase();
  return lower.endsWith(".html") || lower.endsWith(".htm");
}

function pruneTokens(): void {
  const now = Date.now();
  for (const [key, entry] of tokens) {
    if (entry.expiresAt <= now) {
      tokens.delete(key);
    }
  }
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "ENOENT"
  );
}

export type SafeHtmlOpenResult =
  | { ok: true; token: string }
  | { ok: false; reason: "invalid_path" | "hidden" | "not_found" | "not_html" | "too_large" };

export async function createSafeHtmlPreviewToken(
  workspaceRoot: string,
  rawPath: string | null,
): Promise<SafeHtmlOpenResult> {
  const rel = normalizeRelPath(rawPath);
  if (rel === undefined) {
    return { ok: false, reason: "invalid_path" };
  }
  if (isHiddenRelPath(rel)) {
    return { ok: false, reason: "hidden" };
  }
  if (!isHtmlRelPath(rel)) {
    return { ok: false, reason: "not_html" };
  }

  const absPath = resolveInside(workspaceRoot, rel);
  if (isHiddenRelPath(relFromWorkspace(workspaceRoot, absPath))) {
    return { ok: false, reason: "hidden" };
  }

  let fileStat;
  try {
    fileStat = await stat(absPath);
  } catch (err) {
    if (isNotFound(err)) {
      return { ok: false, reason: "not_found" };
    }
    throw err;
  }

  if (!fileStat.isFile()) {
    return { ok: false, reason: "not_found" };
  }
  if (fileStat.size > MAX_HTML_BYTES) {
    return { ok: false, reason: "too_large" };
  }

  const token = randomBytes(24).toString("hex");
  pruneTokens();
  tokens.set(token, {
    relPath: rel,
    workspaceRoot,
    expiresAt: Date.now() + TOKEN_TTL_MS,
  });
  return { ok: true, token };
}

export function resolveSafeHtmlToken(token: string | null): TokenEntry | null {
  if (!token) return null;
  pruneTokens();
  const entry = tokens.get(token);
  if (!entry || entry.expiresAt <= Date.now()) {
    tokens.delete(token);
    return null;
  }
  return entry;
}

export async function readSafeHtmlBytes(
  workspaceRoot: string,
  relPath: string,
): Promise<Buffer | "not_found" | "too_large"> {
  if (isHiddenRelPath(relPath) || !isHtmlRelPath(relPath)) {
    return "not_found";
  }

  const absPath = resolveInside(workspaceRoot, relPath);
  if (isHiddenRelPath(relFromWorkspace(workspaceRoot, absPath))) {
    return "not_found";
  }

  let fileStat;
  try {
    fileStat = await stat(absPath);
  } catch (err) {
    if (isNotFound(err)) {
      return "not_found";
    }
    throw err;
  }

  if (!fileStat.isFile()) {
    return "not_found";
  }
  if (fileStat.size > MAX_HTML_BYTES) {
    return "too_large";
  }

  return await readFile(absPath);
}

function basename(relPath: string): string {
  const parts = relPath.replaceAll("\\", "/").split("/").filter(Boolean);
  return parts.at(-1) ?? relPath;
}

export function buildSafeHtmlWrapperHtml(
  port: number,
  token: string,
  relPath: string,
): string {
  const contentUrl = `http://127.0.0.1:${port}/v1/files/safe-html/content?t=${encodeURIComponent(token)}`;
  const title = basename(relPath);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src http://127.0.0.1:*; style-src 'unsafe-inline'; base-uri 'none'">
  <title>安全预览 · ${title}</title>
  <style>
    html, body { margin: 0; height: 100%; background: #0a0a0f; color: #8b8b9e; }
    .banner {
      font: 12px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
      padding: 8px 12px;
      background: #111119;
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }
  </style>
</head>
<body>
  <div class="banner">沙箱预览 · ${title} · 脚本在隔离 iframe 中运行，无法访问 FlintLoom 工作区与本机其他文件</div>
  <iframe
    title="${title}"
    sandbox="allow-scripts"
    referrerpolicy="no-referrer"
    src="${contentUrl}"
    style="display:block;width:100%;height:calc(100% - 33px);border:0;background:#fff"
  ></iframe>
</body>
</html>`;
}
