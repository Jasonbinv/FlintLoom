import ExcelJS from "exceljs";
import type { Block } from "../generate-types.ts";

export async function renderXlsx(blocks: Block[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  let row = 1;
  for (const block of blocks) {
    switch (block.type) {
      case "heading":
        sheet.getRow(row).getCell(1).value = block.text;
        row += 1;
        break;
      case "paragraph":
        sheet.getRow(row).getCell(1).value = block.text;
        row += 1;
        break;
      case "list":
        for (const item of block.items) {
          sheet.getRow(row).getCell(1).value = item;
          row += 1;
        }
        break;
      case "code":
        sheet.getRow(row).getCell(1).value = block.text;
        row += 1;
        break;
      case "image":
        break;
      case "table":
        const headerRow = sheet.getRow(row);
        block.headers.forEach((header, index) => {
          headerRow.getCell(index + 1).value = header;
        });
        row += 1;
        for (const dataRow of block.rows) {
          const r = sheet.getRow(row);
          dataRow.forEach((cell, index) => {
            r.getCell(index + 1).value = cell;
          });
          row += 1;
        }
        break;
    }
  }
  const buf = await workbook.xlsx.writeBuffer();
  return Buffer.from(buf);
}
