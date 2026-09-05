import { useCallback, useState, type RefObject } from "react";
import {
  convertWorkspaceFile,
  fetchFileBytes,
  writeNewWorkspaceFile,
} from "./files.ts";
import {
  buildA2uiSurfaceHtmlBody,
  buildA2uiSurfaceHtmlDocument,
  buildA2uiSurfaceMarkdown,
  captureA2uiVisualPngs,
  copyDualFormatToClipboard,
  normalizeEmojiKeycapListsForWord,
  saveBinaryFileWithPicker,
  saveTextFileWithPicker,
  suggestA2uiExportFilename,
  wrapHtmlForWordClipboard,
} from "./a2uiSurfaceExport.ts";

type Props = {
  messages: unknown[];
  model: unknown;
  hostRef: RefObject<HTMLElement | null>;
};

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export function A2uiSurfaceExportToolbar({ messages, model, hostRef }: Props) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<"copy" | "md" | "html" | "docx" | null>(null);
  const [status, setStatus] = useState<string>();

  const disabled = busy !== null;

  const handleCopy = useCallback(async () => {
    setBusy("copy");
    setStatus(undefined);
    try {
      const chartPngs = await captureA2uiVisualPngs(hostRef.current);
      const plain = buildA2uiSurfaceMarkdown(
        messages,
        chartPngs,
        { includeChartImages: false, chartVisualFootnote: true },
        model,
      );
      if (!plain.trim()) {
        setStatus("暂无可复制内容");
        return;
      }
      const html = wrapHtmlForWordClipboard(
        buildA2uiSurfaceHtmlBody(messages, chartPngs, { wordPaste: true }, model),
      );
      const ok = await copyDualFormatToClipboard(plain, html);
      if (!ok) {
        setStatus("复制失败，请稍后重试");
        return;
      }
      setCopied(true);
      setStatus("报告已复制到剪贴板");
      window.setTimeout(() => setCopied(false), 2000);
    } finally {
      setBusy(null);
    }
  }, [hostRef, messages, model]);

  const handleExportMarkdown = useCallback(async () => {
    setBusy("md");
    setStatus(undefined);
    try {
      const markdown = buildA2uiSurfaceMarkdown(
        messages,
        {},
        { includeChartImages: false, chartVisualFootnote: true },
        model,
      );
      if (!markdown.trim()) {
        setStatus("暂无可导出内容");
        return;
      }
      const outcome = await saveTextFileWithPicker(
        suggestA2uiExportFilename(messages, "md", model),
        markdown,
        "text/markdown",
      );
      if (outcome === "cancelled") return;
      setStatus(outcome === "saved" ? "已保存到所选位置" : "Markdown 文件已开始下载");
    } finally {
      setBusy(null);
    }
  }, [messages, model]);

  const handleExportHtml = useCallback(async () => {
    setBusy("html");
    setStatus(undefined);
    try {
      const chartPngs = await captureA2uiVisualPngs(hostRef.current);
      const html = buildA2uiSurfaceHtmlDocument(messages, chartPngs, "A2UI 报告", {}, model);
      if (!html.trim()) {
        setStatus("暂无可导出内容");
        return;
      }
      const outcome = await saveTextFileWithPicker(
        suggestA2uiExportFilename(messages, "html", model),
        html,
        "text/html",
      );
      if (outcome === "cancelled") return;
      setStatus(outcome === "saved" ? "已保存到所选位置" : "HTML 文件已开始下载");
    } finally {
      setBusy(null);
    }
  }, [hostRef, messages, model]);

  const handleExportWord = useCallback(async () => {
    setBusy("docx");
    setStatus(undefined);
    try {
      const chartPngs = await captureA2uiVisualPngs(hostRef.current);
      const rasterPngs: Record<string, string> = {};
      for (const [id, src] of Object.entries(chartPngs)) {
        if (/^data:image\/(png|jpe?g);/i.test(src)) rasterPngs[id] = src;
      }
      const markdown = normalizeEmojiKeycapListsForWord(
        buildA2uiSurfaceMarkdown(
          messages,
          rasterPngs,
          { includeChartImages: true, chartVisualFootnote: false },
          model,
        ),
      );
      if (!markdown.trim()) {
        setStatus("暂无可导出内容");
        return;
      }
      const stem = suggestA2uiExportFilename(messages, "docx", model).replace(/\.docx$/i, "");
      const hasRaster = Object.keys(rasterPngs).length > 0;
      if (hasRaster) {
        try {
          const mdPath = await writeNewWorkspaceFile(
            `exports/${stem}.md`,
            new Blob([markdown], { type: "text/markdown;charset=utf-8" }),
          );
          const docxPath = await convertWorkspaceFile(mdPath, `exports/${stem}.docx`);
          const bytes = await fetchFileBytes(docxPath);
          const outcome = await saveBinaryFileWithPicker(
            `${stem}.docx`,
            new Uint8Array(bytes),
            DOCX_MIME,
          );
          if (outcome === "cancelled") return;
          setStatus(
            outcome === "saved"
              ? `已保存到所选位置，同时写入 ${docxPath}`
              : `Word 文件已开始下载，同时写入 ${docxPath}`,
          );
          return;
        } catch {
          // fall through to Word HTML
        }
      }
      const html = wrapHtmlForWordClipboard(
        buildA2uiSurfaceHtmlBody(messages, chartPngs, { wordPaste: true }, model),
      );
      const outcome = await saveTextFileWithPicker(`${stem}.doc`, html, "application/msword");
      if (outcome === "cancelled") return;
      setStatus(outcome === "saved" ? "已保存到所选位置" : "Word 文件已开始下载");
    } finally {
      setBusy(null);
    }
  }, [hostRef, messages, model]);

  return (
    <div className="a2ui-surface-export-toolbar" role="toolbar" aria-label="A2UI 报告操作">
      <button
        type="button"
        className={`a2ui-surface-export-toolbar__btn${copied ? " a2ui-surface-export-toolbar__btn--copied" : ""}`}
        onClick={() => void handleCopy()}
        disabled={disabled}
        title={copied ? "已复制" : "复制报告"}
        aria-label={copied ? "已复制" : "复制"}
      >
        {copied ? "已复制" : "复制"}
      </button>
      <button
        type="button"
        className="a2ui-surface-export-toolbar__btn"
        onClick={() => void handleExportMarkdown()}
        disabled={disabled}
        title="导出 Markdown"
        aria-label="导出 MD"
      >
        {busy === "md" ? "导出中…" : "导出 MD"}
      </button>
      <button
        type="button"
        className="a2ui-surface-export-toolbar__btn"
        onClick={() => void handleExportWord()}
        disabled={disabled}
        title="导出 Word（带图）"
        aria-label="导出 Word"
      >
        {busy === "docx" ? "生成中…" : "导出 Word"}
      </button>
      <button
        type="button"
        className="a2ui-surface-export-toolbar__btn"
        onClick={() => void handleExportHtml()}
        disabled={disabled}
        title="导出 HTML"
        aria-label="导出 HTML"
      >
        {busy === "html" ? "导出中…" : "导出 HTML"}
      </button>
      {status ? <span className="a2ui-surface-export-toolbar__status">{status}</span> : null}
    </div>
  );
}
