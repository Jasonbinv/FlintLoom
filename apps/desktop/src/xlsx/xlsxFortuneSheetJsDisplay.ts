import * as XLSX from "xlsx";

export function fortuneCellKey(row: number, col: number): string {
  return `${row},${col}`;
}

export function buildSheetJsDisplayMaps(
  workbook: XLSX.WorkBook,
): Record<string, Map<string, string>> {
  const out: Record<string, Map<string, string>> = {};
  for (const sheetName of workbook.SheetNames || []) {
    const ws = workbook.Sheets[sheetName];
    const map = new Map<string, string>();
    if (!ws?.["!ref"]) {
      out[sheetName] = map;
      continue;
    }
    const range = XLSX.utils.decode_range(String(ws["!ref"]));
    for (let r = range.s.r; r <= range.e.r; r += 1) {
      for (let c = range.s.c; c <= range.e.c; c += 1) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr];
        const w = typeof cell?.w === "string" ? cell.w.trim() : "";
        if (w) {
          map.set(fortuneCellKey(r, c), w);
        }
      }
    }
    out[sheetName] = map;
  }
  return out;
}

export function readSheetJsWorkbook(arrayBuffer: ArrayBuffer): XLSX.WorkBook {
  return XLSX.read(arrayBuffer, { type: "array", cellDates: false, raw: true });
}
