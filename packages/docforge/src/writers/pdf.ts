import { createRequire } from "node:module";
import { access } from "node:fs/promises";
import type { Block } from "../generate-types.ts";

const PDFDocument = createRequire(import.meta.url)("pdfkit");

export async function renderPdf(blocks: Block[], fontPath: string): Promise<Buffer> {
  try {
    await access(fontPath);
  } catch {
    throw new Error("unreadable");
  }
  return await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 72 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", () => reject(new Error("unreadable")));
    try {
      doc.font(fontPath);
      for (const block of blocks) {
        switch (block.type) {
          case "heading":
            doc.fontSize(Math.max(12, 24 - (block.level - 1) * 2)).text(block.text);
            doc.moveDown(0.4);
            break;
          case "paragraph":
            doc.fontSize(12).text(block.text);
            doc.moveDown(0.4);
            break;
          case "list":
            doc.fontSize(12);
            for (const [i, item] of block.items.entries()) {
              const prefix = block.ordered ? `${i + 1}. ` : "• ";
              doc.text(prefix + item);
            }
            doc.moveDown(0.4);
            break;
          case "code":
            doc.fontSize(11).text(block.text);
            doc.moveDown(0.4);
            break;
          case "image":
            break;
          case "table": {
            doc.fontSize(12).text(block.headers.join(" | "));
            for (const row of block.rows) {
              doc.text(row.join(" | "));
            }
            doc.moveDown(0.4);
            break;
          }
        }
      }
      doc.end();
    } catch {
      reject(new Error("unreadable"));
    }
  });
}
