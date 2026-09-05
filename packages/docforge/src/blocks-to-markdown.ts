import type { Block } from "./generate-types.ts";

function withTrailingNewline(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}

export function blocksToMarkdown(blocks: Block[]): string {
  const lines: string[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case "heading":
        lines.push(`${"#".repeat(block.level)} ${block.text}`);
        lines.push("");
        break;
      case "paragraph":
        lines.push(block.text);
        lines.push("");
        break;
      case "list":
        for (let i = 0; i < block.items.length; i++) {
          const item = block.items[i]!;
          lines.push(block.ordered ? `${i + 1}. ${item}` : `- ${item}`);
        }
        lines.push("");
        break;
      case "code":
        lines.push("```");
        lines.push(block.text);
        lines.push("```");
        lines.push("");
        break;
      case "image":
        lines.push(`![${block.alt}](${block.src})`);
        lines.push("");
        break;
      case "table":
        lines.push(`| ${block.headers.join(" | ")} |`);
        lines.push(`| ${block.headers.map(() => "---").join(" | ")} |`);
        for (const row of block.rows) {
          lines.push(`| ${row.join(" | ")} |`);
        }
        lines.push("");
        break;
    }
  }
  return withTrailingNewline(lines.join("\n"));
}
