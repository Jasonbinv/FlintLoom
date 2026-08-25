import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchFileBytes, writeFileBytes } from "./files.ts";
import { FileXlsxPreview, type FileXlsxPreviewHandle } from "./xlsx/FileXlsxPreview.tsx";

type Props = {
  filePath: string;
  title: string;
};

export function useXlsxPreviewSave(args: {
  enabled: boolean;
  resetKey: string;
  exportXlsx: () => Promise<Blob>;
  onPersist: (blob: Blob) => Promise<void>;
  onReload?: () => void;
}) {
  const { enabled, resetKey, exportXlsx, onPersist, onReload } = args;
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();

  useEffect(() => {
    setDirty(false);
    setSaving(false);
    setSaveError(undefined);
  }, [resetKey]);

  useEffect(() => {
    if (!enabled) {
      setDirty(false);
    }
  }, [enabled]);

  const markDirty = useCallback(() => {
    if (!enabled) return;
    setDirty(true);
    setSaveError(undefined);
  }, [enabled]);

  const discardEdit = useCallback(() => {
    setDirty(false);
    setSaveError(undefined);
    onReload?.();
  }, [onReload]);

  const saveEdit = useCallback(async () => {
    if (saving || !dirty) return false;
    setSaving(true);
    setSaveError(undefined);
    try {
      const blob = await exportXlsx();
      await onPersist(blob);
      setDirty(false);
      return true;
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "保存失败");
      return false;
    } finally {
      setSaving(false);
    }
  }, [dirty, exportXlsx, onPersist, saving]);

  return { dirty, saving, saveError, markDirty, discardEdit, saveEdit };
}

export function SpreadsheetPreview({ filePath, title }: Props) {
  const [arrayBuffer, setArrayBuffer] = useState<ArrayBuffer>();
  const [loadError, setLoadError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const xlsxPreviewRef = useRef<FileXlsxPreviewHandle | null>(null);

  const reload = useCallback(() => {
    setReloadKey((key) => key + 1);
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setLoadError(undefined);
    setArrayBuffer(undefined);
    void fetchFileBytes(filePath, ac.signal)
      .then((bytes) => {
        if (!ac.signal.aborted) setArrayBuffer(bytes);
      })
      .catch(() => {
        if (!ac.signal.aborted) setLoadError("无法加载表格文件");
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [filePath, reloadKey]);

  const canEdit = filePath.toLowerCase().endsWith(".xlsx");

  const { dirty, saving, saveError, markDirty, discardEdit, saveEdit } =
    useXlsxPreviewSave({
      enabled: canEdit && Boolean(arrayBuffer),
      resetKey: `${filePath}:${reloadKey}`,
      exportXlsx: async () => {
        if (!xlsxPreviewRef.current) {
          throw new Error("表格编辑器未就绪");
        }
        return xlsxPreviewRef.current.exportXlsx();
      },
      onPersist: async (blob) => {
        await writeFileBytes(filePath, blob);
      },
      onReload: reload,
    });

  const headerActions = useMemo(() => {
    if (!canEdit) return null;
    return (
      <div className="file-preview-header__action-wrap">
        {dirty ? (
          <>
            <button
              type="button"
              className="file-preview-header__action"
              disabled={saving}
              onClick={() => void saveEdit()}
            >
              {saving ? "保存中…" : "保存"}
            </button>
            <button
              type="button"
              className="file-preview-header__action file-preview-header__action--ghost"
              disabled={saving}
              onClick={discardEdit}
            >
              放弃
            </button>
          </>
        ) : (
          <span className="file-preview-header__hint">可直接编辑单元格</span>
        )}
        {saveError ? (
          <span className="file-preview-header__action-error">{saveError}</span>
        ) : null}
      </div>
    );
  }, [canEdit, dirty, discardEdit, saveEdit, saving, saveError]);

  return (
    <div className="file-preview file-preview--spreadsheet">
      <header className="file-preview-header">
        <span className="file-preview-header__name" title={filePath}>
          {title}
        </span>
        <div className="file-preview-header__actions">
          {headerActions}
          <span className="file-preview-header__badge">Excel</span>
        </div>
      </header>
      {loading ? (
        <div className="file-xlsx-fortune-loading" role="status">正在加载表格…</div>
      ) : loadError || !arrayBuffer ? (
        <div className="file-preview-empty">
          <p className="file-preview-empty__title">无法加载预览</p>
          <p className="file-preview-empty__hint">{loadError ?? "加载失败"}</p>
        </div>
      ) : (
        <FileXlsxPreview
          ref={canEdit ? xlsxPreviewRef : undefined}
          arrayBuffer={arrayBuffer}
          fileName={filePath}
          onDirtyChange={canEdit ? markDirty : undefined}
          editable={canEdit}
        />
      )}
    </div>
  );
}
