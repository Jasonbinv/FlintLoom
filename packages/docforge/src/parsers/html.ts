import { readFile } from "node:fs/promises";
import { NodeHtmlMarkdown } from "node-html-markdown";

export async function parseHtml(absPath: string): Promise<string> {
  const html = await readFile(absPath, "utf8");
  return NodeHtmlMarkdown.translate(html);
}
