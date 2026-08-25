import { useEffect, useState, type ReactNode } from "react";
import { renderMarkdownHtml } from "./markdownPreview.ts";
import type { FilePreview } from "./files.ts";
import {
  fetchSafeHtmlContentUrl,
  isHtmlFilePath,
  openSafeHtmlInBrowser,
} from "./safeHtmlPreview.ts";
import { SpreadsheetPreview } from "./SpreadsheetPreview.tsx";
import { DocumentPreview } from "./DocumentPreview.tsx";

type PreviewKind = FilePreview["kind"] | "error";

type Props = {
  filePath?: string;
  kind: PreviewKind;
  text: string;
};

const EXT_LABELS: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  py: "Python",
  rs: "Rust",
  go: "Go",
  json: "JSON",
  yml: "YAML",
  yaml: "YAML",
  xml: "XML",
  sql: "SQL",
  sh: "Shell",
  bash: "Shell",
  ps1: "PowerShell",
  css: "CSS",
  html: "HTML",
  htm: "HTML",
  txt: "文本",
};

function basename(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.at(-1) ?? path;
}

function previewBadge(filePath: string | undefined, kind: PreviewKind): string {
  if (filePath && isHtmlFilePath(filePath)) return "HTML";
  if (kind === "markdown") return "Markdown";
  if (kind === "pdf") return "PDF";
  if (kind === "docx") return "Word";
  if (kind === "pptx") return "PPT";
  if (kind === "spreadsheet") return "Excel";
  if (kind === "svg") return "SVG";
  if (kind === "failed" || kind === "error") return "无法预览";
  if (!filePath) return "文本";
  const name = basename(filePath);
  if (name === ".env.example") return "Env";
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "文本";
  const ext = name.slice(dot + 1).toLowerCase();
  return EXT_LABELS[ext] ?? ext.toUpperCase();
}

function PreviewHeader({
  title,
  filePath,
  badge,
  actions,
}: {
  title: string;
  filePath?: string;
  badge: string;
  actions?: ReactNode;
}) {
  return (
    <header className="file-preview-header">
      <span className="file-preview-header__name" title={filePath ?? title}>
        {title}
      </span>
      <div className="file-preview-header__actions">
        {actions}
        <span className="file-preview-header__badge">{badge}</span>
      </div>
    </header>
  );
}

function SafeHtmlInlinePreview({ filePath }: { filePath: string }) {
  const [contentSrc, setContentSrc] = useState<string>();
  const [loadError, setLoadError] = useState<string>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setLoadError(undefined);
    setContentSrc(undefined);
    void fetchSafeHtmlContentUrl(filePath, ac.signal)
      .then((src) => {
        if (!ac.signal.aborted) setContentSrc(src);
      })
      .catch(() => {
        if (!ac.signal.aborted) setLoadError("预览加载失败");
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [filePath]);

  if (loading) {
    return (
      <div className="file-preview-html-frame file-preview-html-frame--loading">
        <p className="file-preview-empty__hint">加载 HTML 预览…</p>
      </div>
    );
  }

  if (loadError || !contentSrc) {
    return (
      <div className="file-preview-html-frame file-preview-html-frame--error">
        <p className="file-preview-empty__hint">{loadError ?? "预览加载失败"}</p>
      </div>
    );
  }

  return (
    <div className="file-preview-html-frame">
      <iframe
        title={basename(filePath)}
        className="file-preview-html-iframe"
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        src={contentSrc}
      />
    </div>
  );
}

function SafeHtmlOpenButton({ filePath }: { filePath: string }) {
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string>();

  async function handleOpen() {
    setOpening(true);
    setOpenError(undefined);
    try {
      await openSafeHtmlInBrowser(filePath);
    } catch {
      setOpenError("打开失败");
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="file-preview-header__action-wrap">
      <button
        type="button"
        className="file-preview-header__action"
        disabled={opening}
        title="在系统默认浏览器中以沙箱 iframe 隔离预览"
        onClick={() => void handleOpen()}
      >
        {opening ? "打开中…" : "浏览器安全预览"}
      </button>
      {openError ? (
        <span className="file-preview-header__action-error">{openError}</span>
      ) : null}
    </div>
  );
}

export function FilePreviewContent({ filePath, kind, text }: Props) {
  const title = filePath ? basename(filePath) : "文件预览";
  const badge = previewBadge(filePath, kind);
  const isHtml = filePath ? isHtmlFilePath(filePath) : false;
  const safeHtmlAction =
    isHtml && filePath ? <SafeHtmlOpenButton filePath={filePath} /> : null;

  if (kind === "spreadsheet" && filePath) {
    return <SpreadsheetPreview filePath={filePath} title={title} />;
  }

  if (
    (kind === "pdf" || kind === "docx" || kind === "pptx") &&
    filePath
  ) {
    return (
      <DocumentPreview
        filePath={filePath}
        title={title}
        kind={kind}
      />
    );
  }

  if (kind === "error") {
    return (
      <div className="file-preview file-preview--error">
        <PreviewHeader title={title} badge={badge} />
        <div className="file-preview-empty">
          <p className="file-preview-empty__title">无法加载预览</p>
          <p className="file-preview-empty__hint">{text}</p>
        </div>
      </div>
    );
  }

  if (kind === "failed") {
    return (
      <div className="file-preview file-preview--failed">
        <PreviewHeader title={title} filePath={filePath} badge={badge} actions={safeHtmlAction} />
        <div className="file-preview-empty">
          <p className="file-preview-empty__title">此文件暂不支持内嵌预览</p>
          <p className="file-preview-empty__hint">{text}</p>
        </div>
      </div>
    );
  }

  if (!text.trim() && !filePath) {
    return (
      <div className="file-preview file-preview--idle">
        <div className="file-preview-empty">
          <p className="file-preview-empty__title">选择文件以预览</p>
          <p className="file-preview-empty__hint">在左侧目录树中点击文件</p>
        </div>
      </div>
    );
  }

  if (isHtml && filePath) {
    return (
      <div className="file-preview file-preview--html">
        <PreviewHeader
          title={title}
          filePath={filePath}
          badge={badge}
          actions={safeHtmlAction}
        />
        <SafeHtmlInlinePreview filePath={filePath} />
      </div>
    );
  }

  if (kind === "markdown") {
    const html = renderMarkdownHtml(text);
    return (
      <div className="file-preview file-preview--markdown">
        <PreviewHeader
          title={title}
          filePath={filePath}
          badge={badge}
          actions={safeHtmlAction}
        />
        <article
          className="file-preview-prose"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    );
  }

  return (
    <div className="file-preview file-preview--text">
      <PreviewHeader
        title={title}
        filePath={filePath}
        badge={badge}
        actions={safeHtmlAction}
      />
      <pre className="file-preview-code">
        <code>{text}</code>
      </pre>
    </div>
  );
}
