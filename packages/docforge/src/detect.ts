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

export function detectType(filePath: string, bytes: Uint8Array): DocType {
  const ext = extname(filePath).toLowerCase();
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
  return "unknown";
}
