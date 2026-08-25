import type { Sheet } from "@fortune-sheet/core";

export type FortuneSerializedWorkbook = {
  sheets?: Sheet[];
};

export function parseFortuneSerializedSheets(raw: unknown): Sheet[] {
  if (!raw || typeof raw !== "object") {
    throw new Error("xlsx fortune import returned invalid payload");
  }

  const sheets = (raw as FortuneSerializedWorkbook).sheets;
  if (!Array.isArray(sheets) || sheets.length === 0) {
    throw new Error("xlsx fortune import produced no sheets");
  }

  return sheets;
}
