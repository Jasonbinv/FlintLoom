import { parseBlocks } from "./blocks.ts";
import {
  GENERATE_MAX_BYTES,
  GENERATE_MAX_CHARS,
  type Block,
  type GenerateFormat,
} from "./generate-types.ts";
import { renderHtml } from "./html.ts";

export {
  GENERATE_MAX_BYTES,
  GENERATE_MAX_CHARS,
  type Block,
  type GenerateFormat,
};
export { parseBlocks };

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
  _opts?: { fontPath?: string },
): Promise<Buffer> {
  switch (format) {
    case "md":
      return Buffer.from(copyMarkdown(markdown), "utf8");
    case "html":
      return Buffer.from(renderHtml(parseBlocks(markdown)), "utf8");
    default:
      throw new Error("unreadable");
  }
}
