import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
} from "docx";
import type { Block } from "../generate-types.ts";

const FONT = { ascii: "Noto Sans SC", eastAsia: "Noto Sans SC" };

function run(text: string): TextRun {
  return new TextRun({ text, font: FONT });
}

const LEVELS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
] as const;

export async function renderDocx(blocks: Block[]): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case "heading":
        children.push(
          new Paragraph({
            heading: LEVELS[block.level - 1],
            children: [run(block.text)],
          }),
        );
        break;
      case "paragraph":
        children.push(new Paragraph({ children: [run(block.text)] }));
        break;
      case "list":
        for (const [i, item] of block.items.entries()) {
          const prefix = block.ordered ? `${i + 1}. ` : "• ";
          children.push(new Paragraph({ children: [run(prefix + item)] }));
        }
        break;
      case "code":
        children.push(new Paragraph({ children: [run(block.text)] }));
        break;
      case "table":
        children.push(
          new Table({
            rows: [
              new TableRow({
                children: block.headers.map(
                  (h) => new TableCell({ children: [new Paragraph({ children: [run(h)] })] }),
                ),
              }),
              ...block.rows.map(
                (row) =>
                  new TableRow({
                    children: row.map(
                      (c) =>
                        new TableCell({
                          children: [new Paragraph({ children: [run(c)] })],
                        }),
                    ),
                  }),
              ),
            ],
          }),
        );
        break;
    }
  }
  const doc = new Document({
    sections: [{ children }],
  });
  const packed = await Packer.toBuffer(doc);
  return Buffer.from(packed);
}
