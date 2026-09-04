import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { Sheet } from "@fortune-sheet/core";
import { Workbook, type WorkbookInstance } from "@fortune-sheet/react";
import { importXlsxArrayBufferToFortuneSheets } from "./xlsxFortuneImport.ts";
import { exportFortuneWorkbookToXlsx } from "./xlsxFortuneExport.ts";
import type { FileXlsxPreviewHandle } from "./types.ts";

type Props = {
  arrayBuffer: ArrayBuffer;
  fileName?: string;
  onFallback: () => void;
  onDirtyChange?: () => void;
  editable?: boolean;
};

function resolvePreviewFileName(fileName?: string): string {
  const rawName = (fileName || "preview.xlsx").trim() || "preview.xlsx";
  const lower = rawName.toLowerCase();
  if (
    lower.endsWith(".xlsx") ||
    lower.endsWith(".xls") ||
    lower.endsWith(".csv")
  ) {
    return rawName;
  }
  return `${rawName}.xlsx`;
}

function applySheetDimensions(
  sheetRef: RefObject<WorkbookInstance | null>,
  sheets: Sheet[],
) {
  window.setTimeout(() => {
    try {
      for (const sheet of sheets) {
        if (!sheet.id) continue;
        const config = sheet.config;
        sheetRef.current?.setColumnWidth?.(config?.columnlen || {}, { id: sheet.id });
        sheetRef.current?.setRowHeight?.(config?.rowlen || {}, { id: sheet.id });
      }
    } catch {
      // FortuneSheet may not be ready yet.
    }
  }, 50);
}

function notifyFortuneSheetResize() {
  window.dispatchEvent(new Event("resize"));
}

export const FileXlsxFortunePreview = forwardRef<FileXlsxPreviewHandle, Props>(
  function FileXlsxFortunePreview(
    { arrayBuffer, fileName, onFallback, onDirtyChange, editable = true },
    ref,
  ) {
    const wrapRef = useRef<HTMLDivElement>(null);
    const sheetRef = useRef<WorkbookInstance>(null);
    const onFallbackRef = useRef(onFallback);
    onFallbackRef.current = onFallback;
    const onDirtyChangeRef = useRef(onDirtyChange);
    onDirtyChangeRef.current = onDirtyChange;
    const ignoreOpsRef = useRef(true);

    const [sheets, setSheets] = useState<Sheet[]>([]);
    const [workbookKey, setWorkbookKey] = useState(0);
    const [loading, setLoading] = useState(true);
    const [importFailed, setImportFailed] = useState(false);

    useImperativeHandle(
      ref,
      () => ({
        exportXlsx: () => exportFortuneWorkbookToXlsx(sheetRef),
      }),
      [],
    );

    useEffect(() => {
      let cancelled = false;
      ignoreOpsRef.current = true;
      setLoading(true);
      setImportFailed(false);
      setSheets([]);
      const run = async () => {
        try {
          const resolvedName = resolvePreviewFileName(fileName);
          const importedSheets = await importXlsxArrayBufferToFortuneSheets(
            arrayBuffer,
            resolvedName,
          );
          if (cancelled) return;

          setSheets(importedSheets);
          setWorkbookKey((key) => key + 1);
          applySheetDimensions(sheetRef, importedSheets);
          setLoading(false);
          window.requestAnimationFrame(() => {
            notifyFortuneSheetResize();
          });
        } catch {
          if (!cancelled) {
            setImportFailed(true);
            queueMicrotask(() => onFallbackRef.current());
          }
        }
      };

      void run();
      return () => {
        cancelled = true;
      };
    }, [arrayBuffer, fileName]);

    useEffect(() => {
      if (loading) return undefined;
      const el = wrapRef.current;
      if (!el) return undefined;

      const unlockOpsId = window.setTimeout(() => {
        ignoreOpsRef.current = false;
      }, 0);

      const observer = new ResizeObserver(() => {
        notifyFortuneSheetResize();
      });
      observer.observe(el);
      notifyFortuneSheetResize();

      return () => {
        window.clearTimeout(unlockOpsId);
        ignoreOpsRef.current = true;
        observer.disconnect();
      };
    }, [loading, workbookKey]);

    const handleWorkbookOp = useCallback(() => {
      if (!editable || ignoreOpsRef.current) return;
      queueMicrotask(() => onDirtyChangeRef.current?.());
    }, [editable]);

    if (importFailed) {
      return null;
    }

    return (
      <div
        ref={wrapRef}
        className={`file-xlsx-fortune-wrap${editable ? "" : " file-xlsx-fortune-wrap--readonly"}`}
        data-preview-engine="fortune-sheet"
      >
        {loading || sheets.length === 0 ? (
          <div className="file-xlsx-fortune-loading" role="status" aria-live="polite">
            正在加载表格…
          </div>
        ) : (
          <Workbook
            key={workbookKey}
            ref={sheetRef}
            data={sheets}
            allowEdit={editable}
            showToolbar={editable}
            showFormulaBar={editable}
            showSheetTabs
            lang="zh"
            onOp={editable ? handleWorkbookOp : undefined}
          />
        )}
      </div>
    );
  },
);
