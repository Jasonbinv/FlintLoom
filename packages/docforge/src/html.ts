import type { Block } from "./generate-types.ts";

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderHtml(blocks: Block[]): string {
  const heading = blocks.find((b) => b.type === "heading");
  const title = heading ? escapeHtml(heading.text) : "";
  const body = blocks
    .map((block) => {
      switch (block.type) {
        case "heading":
          return `<h${block.level}>${escapeHtml(block.text)}</h${block.level}>`;
        case "paragraph":
          return `<p>${escapeHtml(block.text)}</p>`;
        case "list": {
          const tag = block.ordered ? "ol" : "ul";
          const items = block.items
            .map((item) => `<li>${escapeHtml(item)}</li>`)
            .join("");
          return `<${tag}>${items}</${tag}>`;
        }
        case "code":
          return `<pre>${escapeHtml(block.text)}</pre>`;
        case "table": {
          const head = `<tr>${block.headers
            .map((h) => `<th>${escapeHtml(h)}</th>`)
            .join("")}</tr>`;
          const rows = block.rows
            .map(
              (row) =>
                `<tr>${row.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`,
            )
            .join("");
          return `<table>${head}${rows}</table>`;
        }
      }
    })
    .join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
}
