import ExcelJS from "exceljs";

function escapeCell(text: string): string {
  return text.replaceAll("|", "\\|");
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (value instanceof Date) {
    return escapeCell(value.toISOString().slice(0, 10));
  }
  if (typeof value !== "object") {
    return escapeCell(String(value));
  }
  if ("richText" in value && Array.isArray(value.richText)) {
    return escapeCell(
      value.richText.map((part) => part.text ?? "").join(""),
    );
  }
  if ("error" in value && value.error != null) {
    return escapeCell(String(value.error));
  }
  if ("formula" in value || "sharedFormula" in value) {
    const formulaCell = value as { result?: ExcelJS.CellValue };
    if (formulaCell.result !== undefined && formulaCell.result !== null) {
      return cellText(formulaCell.result);
    }
    const formula =
      "formula" in value
        ? String(value.formula ?? "")
        : String((value as { sharedFormula?: string }).sharedFormula ?? "");
    return escapeCell(formula);
  }
  if ("text" in value) {
    return escapeCell(String((value as { text: string }).text));
  }
  return escapeCell(String(value));
}

function rowsToTable(rows: string[][]): string {
  if (rows.length === 0) {
    return "";
  }
  const width = Math.max(...rows.map((row) => row.length), 1);
  const padded = rows.map((row) => {
    const next = [...row];
    while (next.length < width) next.push("");
    return next;
  });
  const header = padded[0];
  const sep = header.map(() => "---");
  return [
    `| ${header.join(" | ")} |`,
    `| ${sep.join(" | ")} |`,
    ...padded.slice(1).map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

export async function parseXlsx(
  absPath: string,
): Promise<{ pages: number; markdown: string }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(absPath);
  const sheets = workbook.worksheets.filter(
    (sheet) => sheet.state !== "hidden" && sheet.state !== "veryHidden",
  );
  const parts = sheets.map((sheet) => {
    const rows: string[][] = [];
    sheet.eachRow((row) => {
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      rows.push(values.map((cell) => cellText(cell as ExcelJS.CellValue)));
    });
    const table = rowsToTable(rows);
    return table.length > 0 ? `## ${sheet.name}\n\n${table}` : `## ${sheet.name}`;
  });
  return { pages: sheets.length, markdown: parts.join("\n\n") };
}
