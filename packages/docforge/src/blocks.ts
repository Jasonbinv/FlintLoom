import { marked, type Token, type Tokens } from "marked";
import type { Block } from "./generate-types.ts";

function flattenInline(tokens: Token[] | undefined): string {
  if (!tokens) {
    return "";
  }
  let out = "";
  for (const token of tokens) {
    switch (token.type) {
      case "image":
        break;
      case "link": {
        const label = flattenInline(token.tokens);
        out += label.length > 0 ? label : token.href || token.text;
        break;
      }
      case "strong":
        out += `**${flattenInline(token.tokens)}**`;
        break;
      case "em":
        out += `*${flattenInline(token.tokens)}*`;
        break;
      case "del":
        out += flattenInline(token.tokens);
        break;
      case "codespan":
      case "escape":
        out += token.text;
        break;
      case "text":
        if ("tokens" in token && Array.isArray(token.tokens) && token.tokens.length > 0) {
          out += flattenInline(token.tokens);
        } else {
          out += token.text;
        }
        break;
      case "br":
        out += " ";
        break;
      case "html":
        break;
      default:
        if ("tokens" in token && Array.isArray(token.tokens)) {
          out += flattenInline(token.tokens);
        } else if ("text" in token && typeof token.text === "string") {
          out += token.text;
        }
    }
  }
  return out;
}

function extractImages(tokens: Token[] | undefined): { src: string; alt: string }[] {
  const out: { src: string; alt: string }[] = [];
  if (!tokens) return out;
  for (const token of tokens) {
    if (token.type === "image") {
      const src = String(token.href || "").trim();
      if (src) out.push({ src, alt: String(token.text || "").trim() });
      continue;
    }
    if ("tokens" in token && Array.isArray(token.tokens)) {
      out.push(...extractImages(token.tokens));
    }
  }
  return out;
}

function listItems(items: Tokens.ListItem[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    out.push(...flattenListItem(item.tokens ?? []));
  }
  return out;
}

function flattenListItem(tokens: Token[]): string[] {
  const texts: string[] = [];
  let current = "";
  for (const token of tokens) {
    if (token.type === "list") {
      if (current.trim().length > 0) {
        texts.push(current.trim());
        current = "";
      }
      texts.push(...listItems(token.items));
    } else {
      current += flattenInline([token]);
    }
  }
  if (current.trim().length > 0) {
    texts.push(current.trim());
  }
  return texts.length > 0 ? texts : [""];
}

function walk(tokens: Token[]): Block[] {
  const blocks: Block[] = [];
  for (const token of tokens) {
    switch (token.type) {
      case "heading": {
        const level = Math.min(6, Math.max(1, token.depth)) as 1 | 2 | 3 | 4 | 5 | 6;
        blocks.push({ type: "heading", level, text: flattenInline(token.tokens) });
        break;
      }
      case "paragraph": {
        const text = flattenInline(token.tokens).trim();
        if (text.length > 0) {
          blocks.push({ type: "paragraph", text });
        }
        for (const image of extractImages(token.tokens)) {
          blocks.push({ type: "image", src: image.src, alt: image.alt });
        }
        break;
      }
      case "blockquote":
        blocks.push(...walk(token.tokens ?? []));
        break;
      case "list":
        blocks.push({
          type: "list",
          ordered: token.ordered === true,
          items: listItems(token.items),
        });
        break;
      case "code":
        blocks.push({ type: "code", text: token.text.replace(/\n$/, "") });
        break;
      case "table": {
        const table = token as Tokens.Table;
        const headers = table.header.map((cell) => flattenInline(cell.tokens));
        const rows = table.rows.map((row) => {
          const cells = row.map((cell) => flattenInline(cell.tokens));
          while (cells.length < headers.length) {
            cells.push("");
          }
          return cells;
        });
        blocks.push({ type: "table", headers, rows });
        break;
      }
      case "space":
      case "hr":
      case "html":
      case "def":
        break;
      default:
        break;
    }
  }
  return blocks;
}

export function parseBlocks(markdown: string): Block[] {
  return walk(marked.lexer(markdown, { gfm: true }));
}
