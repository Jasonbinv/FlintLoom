import JSZip from "jszip";
import type { Sheet } from "@fortune-sheet/core";
import { FortuneFile } from "@corbe30/fortune-excel/dist/ToFortuneSheet/FortuneFile";
import { buildSheetJsDisplayMaps, readSheetJsWorkbook } from "./xlsxFortuneSheetJsDisplay.ts";
import { normalizeFortuneSheets } from "./xlsxFortuneNormalize.ts";
import { parseFortuneSerializedSheets } from "./xlsxPreviewContract.ts";

type OfficeZipFileMap = Record<string, string>;

async function unzipXlsxOfficeArchive(arrayBuffer: ArrayBuffer): Promise<OfficeZipFileMap> {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const fileList: OfficeZipFileMap = {};

  for (const zipEntry of Object.values(zip.files)) {
    if (zipEntry.dir) continue;

    const fileName = zipEntry.name;
    const suffix = fileName.split(".").pop()?.toLowerCase() ?? "";
    let fileType: "string" | "base64" | "arraybuffer" = "string";

    if (["png", "jpeg", "jpg", "gif", "bmp", "tif", "webp"].includes(suffix)) {
      fileType = "base64";
    } else if (suffix === "emf") {
      fileType = "arraybuffer";
    }

    const raw = await zipEntry.async(fileType);
    if (fileType === "base64" && typeof raw === "string") {
      fileList[fileName] = `data:image/${suffix};base64,${raw}`;
    } else if (typeof raw === "string") {
      fileList[fileName] = raw;
    }
  }

  return fileList;
}

export async function importXlsxArrayBufferToFortuneSheets(
  arrayBuffer: ArrayBuffer,
  fileName: string,
): Promise<Sheet[]> {
  const files = await unzipXlsxOfficeArchive(arrayBuffer);
  const fortuneFile = new FortuneFile(files, fileName);
  fortuneFile.Parse();
  const sheets = parseFortuneSerializedSheets(fortuneFile.serialize());
  const sheetJsWorkbook = readSheetJsWorkbook(arrayBuffer);
  const sheetJsDisplaysBySheetName = buildSheetJsDisplayMaps(sheetJsWorkbook);
  return normalizeFortuneSheets(sheets, { sheetJsDisplaysBySheetName });
}
