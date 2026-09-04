import type { Sheet } from "@fortune-sheet/core";
import type { WorkbookInstance } from "@fortune-sheet/react";
import { transformFortuneToExcel } from "@corbe30/fortune-excel";
import { IFileType } from "@corbe30/fortune-excel/dist/common/ICommon";
import { normalizeFortuneSheet } from "./xlsxFortuneNormalize.ts";

type FortuneWorkbookRef = { current: WorkbookInstance | null };

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function toXlsxBlob(result: unknown): Blob {
  if (result instanceof Blob) {
    if (!result.type) {
      return new Blob([result], { type: XLSX_MIME });
    }
    return result;
  }
  if (result instanceof ArrayBuffer) {
    return new Blob([result], { type: XLSX_MIME });
  }
  throw new Error("export returned unexpected type");
}

function sheetWithMatrixData(wb: WorkbookInstance, sheet: Sheet): Sheet {
  if (sheet.data?.length) {
    return sheet;
  }
  const celldata = sheet.celldata;
  if (!celldata?.length) {
    return sheet;
  }
  const rowCount = sheet.row ?? 84;
  const colCount = sheet.column ?? 60;
  const data = wb.celldataToData(celldata, rowCount, colCount);
  if (!data?.length) {
    return sheet;
  }
  return { ...sheet, data };
}

function buildFortuneExcelExportRef(wb: WorkbookInstance): FortuneWorkbookRef {
  const sanitize = (sheet: Sheet) => normalizeFortuneSheet(sheetWithMatrixData(wb, sheet));

  return {
    current: {
      getAllSheets: () => wb.getAllSheets().map(sanitize),
      getSheet: () => sanitize(wb.getSheet()),
    } as WorkbookInstance,
  };
}

export async function exportFortuneWorkbookToXlsx(
  sheetRef: FortuneWorkbookRef,
): Promise<Blob> {
  if (!sheetRef.current) {
    throw new Error("workbook not ready");
  }
  const exportRef = buildFortuneExcelExportRef(sheetRef.current);
  const exported = await transformFortuneToExcel(exportRef, IFileType.XLSX, false);
  return toXlsxBlob(exported);
}
