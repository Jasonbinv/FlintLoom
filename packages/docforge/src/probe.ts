import { readFile } from "node:fs/promises";
import { detectType } from "./detect.ts";
import { parsePdf } from "./parsers/pdf.ts";
import type { DocType, ProbeResult } from "./types.ts";

const PARSEABLE: ReadonlySet<DocType> = new Set([
  "md",
  "html",
  "pdf",
  "docx",
  "pptx",
  "xlsx",
]);

function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "ENOENT"
  );
}

export async function probe(absPath: string): Promise<ProbeResult> {
  let bytes: Buffer;
  try {
    bytes = await readFile(absPath);
  } catch (err) {
    if (isNotFound(err)) {
      return { type: "unknown", parseable: false, reason: "not found" };
    }
    return { type: "unknown", parseable: false, reason: "unreadable" };
  }

  const type = detectType(absPath, bytes);
  if (!PARSEABLE.has(type)) {
    return { type, parseable: false, reason: "unsupported type" };
  }

  if (type === "pdf") {
    try {
      const pdf = await parsePdf(absPath);
      return { type: "pdf", parseable: true, pages: pdf.pages };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/password|encrypt/i.test(message)) {
        return { type: "pdf", parseable: false, reason: "encrypted" };
      }
      return { type: "pdf", parseable: false, reason: "unreadable" };
    }
  }

  return { type, parseable: true };
}
