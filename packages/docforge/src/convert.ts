import { readFile, stat, writeFile } from "node:fs/promises";
import { detectType } from "./detect.ts";
import {
  GENERATE_MAX_BYTES,
  GENERATE_MAX_CHARS,
  buildDocument,
  formatFromOutRelPath,
  type GenerateFormat,
} from "./generate.ts";
import { parse } from "./parse.ts";
import type { DocType } from "./types.ts";

export type ConvertFrom = "md" | "html" | "pdf" | "docx" | "pptx" | "xlsx";

const PARSE_FAIL_REASONS = new Set([
  "empty text",
  "encrypted",
  "unsupported type",
  "not found",
  "unreadable",
]);

function isConvertFrom(type: DocType): type is ConvertFrom {
  return type !== "unknown";
}

function ioCode(err: unknown): string {
  return typeof err === "object" && err !== null && "code" in err
    ? (err as { code: string }).code
    : "";
}

export function lossForConvert(from: ConvertFrom, format: GenerateFormat): string {
  if (from === "md") {
    return format === "md" ? "none" : "images skipped; emphasis flattened";
  }
  switch (from) {
    case "html":
      return "scripts and layout discarded";
    case "pdf":
      return "images and layout discarded; text only";
    case "docx":
      return "images and complex formatting discarded";
    case "pptx":
      return "notes and images discarded; slide text only";
    case "xlsx":
      return "formulas charts and formatting discarded; tables as text";
  }
}

export async function convertDocument(
  absSource: string,
  absOut: string,
): Promise<{ from: ConvertFrom; format: GenerateFormat; loss: string }> {
  const format = formatFromOutRelPath(absOut);
  if (format === undefined) {
    throw new Error("bad out");
  }
  let st;
  try {
    st = await stat(absSource);
  } catch (err) {
    if (ioCode(err) === "ENOENT") {
      throw new Error("not found");
    }
    throw new Error("unreadable");
  }
  if (!st.isFile()) {
    throw new Error("unreadable");
  }
  if (st.size > GENERATE_MAX_BYTES) {
    throw new Error("too large");
  }
  const bytes = await readFile(absSource);
  const detected = detectType(absSource, bytes);
  if (!isConvertFrom(detected)) {
    throw new Error("unsupported type");
  }
  const markdown = await parse(absSource);
  for (const reason of PARSE_FAIL_REASONS) {
    if (markdown === `failed: ${reason}`) {
      throw new Error(reason);
    }
  }
  if (markdown.length > GENERATE_MAX_CHARS) {
    throw new Error("too large");
  }
  const payload = await buildDocument(format, markdown);
  await writeFile(absOut, payload);
  return {
    from: detected,
    format,
    loss: lossForConvert(detected, format),
  };
}
