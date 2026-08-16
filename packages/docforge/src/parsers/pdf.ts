import { readFile } from "node:fs/promises";
import { extractText, getDocumentProxy } from "unpdf";

export async function parsePdf(
  absPath: string,
): Promise<{ pages: number; markdown: string }> {
  const bytes = new Uint8Array(await readFile(absPath));
  const pdf = await getDocumentProxy(bytes);
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [text];
  const hasText = pages.some((page) => page.trim().length > 0);
  if (!hasText) {
    return { pages: totalPages, markdown: "" };
  }
  const markdown = pages
    .map((page, index) => `## Page ${index + 1}\n\n${page.trim()}`)
    .join("\n\n");
  return { pages: totalPages, markdown };
}
