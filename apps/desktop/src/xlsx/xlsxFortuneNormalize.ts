import type { Sheet } from "@fortune-sheet/core";
import { applyFortuneCellDateDisplayValue } from "./xlsxFortuneDisplayValue.ts";
import { fortuneCellKey } from "./xlsxFortuneSheetJsDisplay.ts";

export type NormalizeFortuneSheetsOptions = {
  sheetJsDisplaysBySheetName?: Record<string, Map<string, string>>;
};

type FortuneCell = {
  v?: unknown;
  m?: string;
  ct?: {
    t?: string;
    fa?: string;
    s?: Array<{ v?: string; [key: string]: unknown }>;
  };
  [key: string]: unknown;
};

type CelldataEntry = { r: number; c: number; v: unknown };

function sanitizeFortuneCell(cell: unknown): unknown {
  if (!cell || typeof cell !== "object") {
    return cell;
  }

  const normalized = cell as FortuneCell;
  const ct = normalized.ct;
  if (ct?.t !== "inlineStr") {
    return normalized;
  }

  if (Array.isArray(ct.s) && ct.s.length > 0) {
    return normalized;
  }

  const text =
    (typeof normalized.v === "string" && normalized.v) ||
    (typeof normalized.m === "string" && normalized.m) ||
    "";

  if (text) {
    normalized.v = normalized.v ?? text;
    normalized.m = typeof normalized.m === "string" ? normalized.m : text;
  }

  normalized.ct = { t: "g", fa: ct.fa ?? "General" };
  return normalized;
}

function normalizeFortuneCell(
  cell: unknown,
  row?: number,
  col?: number,
  sheetJsDisplayMap?: Map<string, string>,
): unknown {
  if (!cell || typeof cell !== "object") {
    return cell;
  }
  const sheetJsDisplay =
    row != null && col != null
      ? sheetJsDisplayMap?.get(fortuneCellKey(row, col))
      : undefined;
  return applyFortuneCellDateDisplayValue(sanitizeFortuneCell(cell) as FortuneCell, {
    sheetJsDisplay,
  });
}

function sanitizeCellMatrix(
  data: Sheet["data"],
  sheetJsDisplayMap?: Map<string, string>,
): Sheet["data"] {
  if (!data?.length) {
    return data;
  }

  return data.map(
    (row: unknown[] | undefined, rowIndex: number) =>
      row?.map(
        (cell: unknown, colIndex: number) =>
          normalizeFortuneCell(cell, rowIndex, colIndex, sheetJsDisplayMap) as typeof cell,
      ) ?? [],
  ) as Sheet["data"];
}

function sanitizeCelldata(
  celldata: CelldataEntry[] | undefined,
  sheetJsDisplayMap?: Map<string, string>,
): CelldataEntry[] | undefined {
  if (!celldata?.length) {
    return celldata;
  }

  return celldata.map((entry) => ({
    ...entry,
    v: normalizeFortuneCell(entry.v, entry.r, entry.c, sheetJsDisplayMap),
  }));
}

function normalizeBorderInfo(borderInfo: unknown): NonNullable<Sheet["config"]>["borderInfo"] {
  if (!Array.isArray(borderInfo)) {
    return [];
  }

  return borderInfo.filter((item) => {
    if (!item || typeof item !== "object") {
      return false;
    }
    const range = (item as { range?: unknown }).range;
    return Array.isArray(range) && range.length > 0;
  }) as NonNullable<Sheet["config"]>["borderInfo"];
}

export function normalizeFortuneSheet(
  sheet: Sheet,
  index = 0,
  options?: NormalizeFortuneSheetsOptions,
): Sheet {
  const sheetJsDisplayMap = sheet.name
    ? options?.sheetJsDisplaysBySheetName?.[sheet.name]
    : undefined;
  const baseConfig = sheet.config ?? {};
  const { borderInfo: rawBorderInfo, ...restConfig } = baseConfig;
  const config: NonNullable<Sheet["config"]> = {
    merge: {},
    rowlen: {},
    columnlen: {},
    ...restConfig,
    borderInfo: normalizeBorderInfo(rawBorderInfo),
  };

  const normalized: Sheet = {
    ...sheet,
    id: sheet.id ?? sheet.name ?? `sheet-${index}`,
    config,
    calcChain: sheet.calcChain ?? [],
  };

  if (normalized.celldata?.length) {
    normalized.celldata = sanitizeCelldata(
      normalized.celldata as CelldataEntry[],
      sheetJsDisplayMap,
    ) as Sheet["celldata"];
  }
  if (normalized.data?.length) {
    normalized.data = sanitizeCellMatrix(normalized.data, sheetJsDisplayMap);
  }

  return normalized;
}

export function normalizeFortuneSheets(
  sheets: Sheet[],
  options?: NormalizeFortuneSheetsOptions,
): Sheet[] {
  return sheets.map((sheet, index) => normalizeFortuneSheet(sheet, index, options));
}
