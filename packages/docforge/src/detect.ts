import { extname } from "node:path";
import type { DocType } from "./types.ts";

const BY_EXT: Record<string, DocType> = {
  ".md": "md",
  ".markdown": "md",
  ".html": "html",
  ".htm": "html",
  ".pdf": "pdf",
  ".docx": "docx",
  ".pptx": "pptx",
  ".xlsx": "xlsx",
};

const UNKNOWN_EXT = new Set([
  ".doc",
  ".docm",
  ".xlsm",
  ".pptm",
  ".dotm",
  ".xltm",
  ".potm",
]);

function looksLikeHtml(bytes: Uint8Array): boolean {
  const head = Buffer.from(bytes.subarray(0, 256))
    .toString("utf8")
    .trimStart()
    .toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html");
}

function looksLikePdf(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  );
}

function zipContains(bytes: Uint8Array, part: string): boolean {
  return Buffer.from(bytes).includes(part);
}

export function detectType(filePath: string, bytes: Uint8Array): DocType {
  const ext = extname(filePath).toLowerCase();
  if (UNKNOWN_EXT.has(ext)) {
    return "unknown";
  }
  const fromExt = BY_EXT[ext];
  if (fromExt !== undefined) {
    return fromExt;
  }
  if (looksLikePdf(bytes)) {
    return "pdf";
  }
  if (looksLikeHtml(bytes)) {
    return "html";
  }
  if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    if (zipContains(bytes, "word/")) return "docx";
    if (zipContains(bytes, "ppt/")) return "pptx";
    if (zipContains(bytes, "xl/")) return "xlsx";
  }
  return "unknown";
}
