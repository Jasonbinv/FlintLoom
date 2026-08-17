import { stat, readFile, writeFile } from "node:fs/promises";
import { parseBlocks } from "./blocks.ts";
import { detectType } from "./detect.ts";
import { defaultFontPath } from "./font.ts";
import {
  GENERATE_MAX_BYTES,
  GENERATE_MAX_CHARS,
  type Block,
  type GenerateFormat,
} from "./generate-types.ts";
import { renderHtml } from "./html.ts";
import { renderDocx } from "./writers/docx.ts";
import { renderPdf } from "./writers/pdf.ts";

export {
  GENERATE_MAX_BYTES,
  GENERATE_MAX_CHARS,
  type Block,
  type GenerateFormat,
};
export { parseBlocks };
export { defaultFontPath };

export function formatFromOutRelPath(relPath: string): GenerateFormat | undefined {
  const lower = relPath.replaceAll("\\", "/").toLowerCase();
  if (lower.endsWith(".md")) return "md";
  if (lower.endsWith(".html")) return "html";
  if (lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".pdf")) return "pdf";
  return undefined;
}

export function copyMarkdown(raw: string): string {
  const body = raw.startsWith("\uFEFF") ? raw.slice(1) : raw;
  return body.endsWith("\n") ? body : `${body}\n`;
}

export async function buildDocument(
  format: GenerateFormat,
  markdown: string,
  opts?: { fontPath?: string },
): Promise<Buffer> {
  try {
    switch (format) {
      case "md":
        return Buffer.from(copyMarkdown(markdown), "utf8");
      case "html":
        return Buffer.from(renderHtml(parseBlocks(markdown)), "utf8");
      case "docx":
        return await renderDocx(parseBlocks(markdown));
      case "pdf":
        return await renderPdf(parseBlocks(markdown), opts?.fontPath ?? defaultFontPath());
    }
  } catch (err) {
    if (err instanceof Error && err.message === "unreadable") {
      throw err;
    }
    throw new Error("unreadable");
  }
}

export async function generateDocument(
  absSource: string,
  absOut: string,
): Promise<{ format: GenerateFormat }> {
  const format = formatFromOutRelPath(absOut);
  if (format === undefined) {
    throw new Error("bad out");
  }
  let st;
  try {
    st = await stat(absSource);
  } catch (err) {
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? (err as { code: string }).code
        : "";
    if (code === "ENOENT") {
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
  if (detectType(absSource, bytes) !== "md") {
    throw new Error("bad source");
  }
  let raw = bytes.toString("utf8");
  if (raw.startsWith("\uFEFF")) {
    raw = raw.slice(1);
  }
  if (raw.length > GENERATE_MAX_CHARS) {
    throw new Error("too large");
  }
  const payload = await buildDocument(format, raw);
  await writeFile(absOut, payload);
  return { format };
}
