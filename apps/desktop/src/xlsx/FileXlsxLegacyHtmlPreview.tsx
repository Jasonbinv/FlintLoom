import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { CSV_PREVIEW_MAX_ROWS, readLegacyPreviewWorkbook } from "./readLegacyPreviewWorkbook.ts";

type Props = {
  arrayBuffer: ArrayBuffer;
  fileName?: string;
};

export function FileXlsxLegacyHtmlPreview({ arrayBuffer, fileName }: Props) {
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState<string>("");
  const [renderError, setRenderError] = useState(false);
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [rowLimitApplied, setRowLimitApplied] = useState(false);

  useEffect(() => {
    setRenderError(false);
    setRowLimitApplied(false);
    try {
      const { workbook: wb, rowLimitApplied: limited } = readLegacyPreviewWorkbook(
        arrayBuffer,
        fileName,
      );
      setRowLimitApplied(limited);
      setWorkbook(wb);
      const names = wb.SheetNames || [];
      setSheetNames(names);
      setActiveSheet(names[0] ?? "");
    } catch {
      setRenderError(true);
      setWorkbook(null);
      setSheetNames([]);
      setActiveSheet("");
    }
  }, [arrayBuffer, fileName]);

  const html = useMemo(() => {
    if (!workbook || !activeSheet) return "";
    const ws = workbook.Sheets[activeSheet];
    if (!ws) return "";
    try {
      return XLSX.utils.sheet_to_html(ws, { editable: false });
    } catch {
      return "";
    }
  }, [workbook, activeSheet]);

  if (renderError) {
    return (
      <div className="file-xlsx-error">
        <p>表格内容解析失败，请下载后查看</p>
      </div>
    );
  }

  return (
    <div className="file-xlsx-wrap file-xlsx-wrap--legacy">
      {rowLimitApplied ? (
        <p className="file-xlsx-row-limit-hint" role="status">
          仅预览前 {CSV_PREVIEW_MAX_ROWS} 行，完整内容请下载原文件。
        </p>
      ) : null}
      {sheetNames.length > 1 ? (
        <div className="file-xlsx-tabs" role="tablist" aria-label="工作表切换">
          {sheetNames.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={name === activeSheet}
              className={`file-xlsx-tab${name === activeSheet ? " file-xlsx-tab--active" : ""}`}
              onClick={() => setActiveSheet(name)}
              title={name}
            >
              {name}
            </button>
          ))}
        </div>
      ) : null}
      <div className="file-xlsx-table" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
