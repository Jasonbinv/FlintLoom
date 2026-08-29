import { useState } from "react";
import { convertWorkspaceFile } from "./files.ts";
import {
  exportOutPath,
  exportTargets,
  outputFormatOf,
  type OutputFormat,
} from "./outputFormat.ts";

export function ExportFormatButton(props: {
  filePath: string;
  onExported?: (path: string) => void;
}): JSX.Element | null {
  const targets = exportTargets(props.filePath);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  if (targets.length === 0) return null;

  async function exportTo(format: OutputFormat): Promise<void> {
    setBusy(true);
    setError(undefined);
    setOpen(false);
    try {
      const out = await convertWorkspaceFile(
        props.filePath,
        exportOutPath(props.filePath, format),
      );
      props.onExported?.(out);
    } catch {
      setError("导出失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="file-preview-header__action-wrap">
      <button
        type="button"
        className="file-preview-header__action"
        disabled={busy}
        title="将当前文件转换为另一种格式"
        onClick={() => setOpen((current) => !current)}
      >
        {busy ? "导出中…" : "导出"}
      </button>
      {open ? (
        <div className="file-preview-export-menu" role="listbox">
          {targets.map((id) => (
            <button
              key={id}
              type="button"
              className="file-preview-export-option"
              onClick={() => void exportTo(id)}
            >
              {outputFormatOf(id).label}
            </button>
          ))}
        </div>
      ) : null}
      {error ? (
        <span className="file-preview-header__action-error">{error}</span>
      ) : null}
    </div>
  );
}
