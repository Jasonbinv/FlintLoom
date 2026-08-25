import * as XLSX from "xlsx";

type FortuneCellLike = {
  v?: unknown;
  m?: string;
  ct?: {
    t?: string;
    fa?: string;
  };
};

export type FortuneCellDisplayOptions = {
  sheetJsDisplay?: string | null;
};

const BUILTIN_DATE_NUMFMT_IDS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36,
  45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58,
]);

const EXCEL_DATE_SERIAL_MIN = 25569;
const EXCEL_DATE_SERIAL_MAX = 60000;

export const CHINESE_MONTH_DAY_FORMAT = 'm"月"d"日"';

const DATE_FORMAT_PATTERN =
  /(?:^|[^0-9#?])([dmyhs])(?:[^0-9#?]|$)|[年月日时分秒]|am\/pm|a\/p/i;

function readFormatString(cell: FortuneCellLike): string {
  return String(cell.ct?.fa ?? "").trim();
}

function isGeneralOrMissingFormat(formatString: string): boolean {
  const raw = formatString.trim();
  return !raw || raw.toLowerCase() === "general";
}

export function isExcelDateFormatString(
  formatString: string | undefined | null,
): boolean {
  const raw = String(formatString ?? "").trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();
  if (lower === "general" || lower === "@") return false;

  if (/^\d+$/.test(raw)) {
    const id = Number(raw);
    return Number.isInteger(id) && BUILTIN_DATE_NUMFMT_IDS.has(id);
  }

  if (/[年月日时分秒]/.test(raw)) return true;
  if (!DATE_FORMAT_PATTERN.test(raw)) return false;

  const hasNumberTokens = /[#0?,]/.test(raw);
  const hasDateTokens =
    /y{1,4}|d{1,4}|h{1,2}|s{1,2}/i.test(raw) ||
    /m{1,5}/i.test(raw) ||
    /[年月日时分秒]/.test(raw);
  if (hasNumberTokens && !hasDateTokens) return false;
  return hasDateTokens;
}

export function isExcelDateSerial(serial: number): boolean {
  if (!Number.isFinite(serial)) return false;
  return serial >= EXCEL_DATE_SERIAL_MIN && serial <= EXCEL_DATE_SERIAL_MAX;
}

function serialNumberFromCellValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function serialLooksLikeDisplayString(serial: number, display: string): boolean {
  const trimmed = display.trim();
  if (!trimmed) return true;
  const asInt = Math.trunc(serial);
  return trimmed === String(serial) || trimmed === String(asInt);
}

export function formatExcelSerialForDisplay(
  serial: number,
  formatString: string,
): string | null {
  const fmt = String(formatString || "").trim();
  if (!fmt) return null;
  try {
    const formatted = XLSX.SSF.format(fmt, serial);
    const text = String(formatted ?? "").trim();
    if (!text || serialLooksLikeDisplayString(serial, text)) return null;
    return text;
  } catch {
    return null;
  }
}

function resolveDateDisplayForSerial(
  serial: number,
  formatString: string,
  sheetJsDisplay?: string | null,
): { display: string; fa: string } | null {
  if (isExcelDateFormatString(formatString)) {
    const explicit = formatExcelSerialForDisplay(serial, formatString);
    if (explicit) return { display: explicit, fa: formatString };
  }

  const zh = formatExcelSerialForDisplay(serial, CHINESE_MONTH_DAY_FORMAT);
  if (zh) return { display: zh, fa: CHINESE_MONTH_DAY_FORMAT };

  const w = String(sheetJsDisplay ?? "").trim();
  if (w && !serialLooksLikeDisplayString(serial, w)) {
    return { display: w, fa: "m/d/yy" };
  }

  return null;
}

function shouldSkipAsTextCell(cell: FortuneCellLike): boolean {
  const ctType = String(cell.ct?.t ?? "")
    .trim()
    .toLowerCase();
  return ctType === "s" || ctType === "inlinestr" || ctType === "g";
}

function applyResolvedDisplay<T extends FortuneCellLike>(
  cell: T,
  serial: number,
  resolved: { display: string; fa: string },
): T & FortuneCellLike {
  cell.m = resolved.display;
  cell.v = serial;
  cell.ct = {
    ...(cell.ct ?? {}),
    fa: resolved.fa,
    t: "d",
  };
  return cell;
}

export function applyFortuneCellDateDisplayValue<T extends FortuneCellLike>(
  cell: T,
  options?: FortuneCellDisplayOptions,
): T & FortuneCellLike {
  if (!cell || typeof cell !== "object") return cell;
  if (shouldSkipAsTextCell(cell)) return cell;

  const serial = serialNumberFromCellValue(cell.v);
  if (serial == null) return cell;

  const formatString = readFormatString(cell);
  const ctType = String(cell.ct?.t ?? "")
    .trim()
    .toLowerCase();
  const existingDisplay = typeof cell.m === "string" ? cell.m.trim() : "";

  if (existingDisplay && !serialLooksLikeDisplayString(serial, existingDisplay)) {
    return cell;
  }

  const generalDateSerial =
    isExcelDateSerial(serial) &&
    (isGeneralOrMissingFormat(formatString) || ctType === "n");

  if (generalDateSerial) {
    const resolved = resolveDateDisplayForSerial(
      serial,
      formatString,
      options?.sheetJsDisplay,
    );
    if (resolved) return applyResolvedDisplay(cell, serial, resolved);
  }

  if (!isExcelDateFormatString(formatString) && ctType !== "d") {
    const w = String(options?.sheetJsDisplay ?? "").trim();
    if (w && !serialLooksLikeDisplayString(serial, w)) {
      cell.m = w;
    }
    return cell;
  }

  const display = formatExcelSerialForDisplay(serial, formatString);
  if (!display) return cell;

  cell.m = display;
  if (ctType !== "d") {
    cell.ct = { ...(cell.ct ?? {}), fa: formatString, t: "d" };
    cell.v = serial;
  }
  return cell;
}
