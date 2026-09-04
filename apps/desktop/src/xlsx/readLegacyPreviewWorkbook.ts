import * as XLSX from "xlsx";
import { decodeCnLegacyTextBytes } from "./decodeCnLegacyTextBytes.ts";

export const CSV_PREVIEW_MAX_ROWS = 500;

export function readLegacyPreviewWorkbook(
  arrayBuffer: ArrayBuffer,
  fileName?: string,
): { workbook: XLSX.WorkBook; rowLimitApplied: boolean } {
  const isCsv = (fileName || "").trim().toLowerCase().endsWith(".csv");
  if (isCsv) {
    const text = decodeCnLegacyTextBytes(new Uint8Array(arrayBuffer));
    return {
      workbook: XLSX.read(text, {
        type: "string",
        sheetRows: CSV_PREVIEW_MAX_ROWS,
      }),
      rowLimitApplied: true,
    };
  }
  return {
    workbook: XLSX.read(arrayBuffer, { type: "array" }),
    rowLimitApplied: false,
  };
}
