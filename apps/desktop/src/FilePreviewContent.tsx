import { useEffect, useState, type ReactNode } from "react";
import { renderMarkdownHtml } from "./markdownPreview.ts";
import type { FilePreview } from "./files.ts";
import {
  fetchSafeHtmlContentUrl,
  isHtmlFilePath,
  openSafeHtmlInBrowser,
} from "./safeHtmlPreview.ts";
import { ExportFormatButton } from "./ExportFormatButton.tsx";
import { SpreadsheetPreview } from "./SpreadsheetPreview.tsx";
import { DocumentPreview } from "./DocumentPreview.tsx";

type PreviewKind = FilePreview["kind"] | "error";

type Props = {
  filePath?: string;
  kind: PreviewKind;
  text: string;
  cacheKey?: number | string;
  onClose?: () => void;
  onQuote?: () => void;
  onExported?: (path: string) => void;
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
  if (kind === "audio") return "音频";
  if (kind === "video") return "视频";
  if (kind === "image") return "图片";
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
  onClose,
  onQuote,
}: {
  title: string;
  filePath?: string;
  badge: string;
  actions?: ReactNode;
  onClose?: () => void;
  onQuote?: () => void;
}) {
  return (
    <header className="file-preview-header">
      <span className="file-preview-header__name" title={filePath ?? title}>
        {title}
      </span>
      <div className="file-preview-header__actions">
        {actions}
        {onQuote ? (
          <button
            type="button"
            className="file-preview-header__action"
            onClick={onQuote}
            title="将文件路径插入输入框，供对话引用"
          >
            引用
          </button>
        ) : null}
        <span className="file-preview-header__badge">{badge}</span>
        {onClose ? (
          <button
            type="button"
            className="file-preview-header__close icon-btn"
            onClick={onClose}
            aria-label="关闭预览"
            title="关闭预览"
          >
            ×
          </button>
        ) : null}
      </div>
    </header>
  );
}

export function FilePreviewCloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      className="file-preview-header__close icon-btn"
      onClick={onClose}
      aria-label="关闭预览"
      title="关闭预览"
    >
      ×
    </button>
  );
}

function ImageFilePreview({
  filePath,
  title,
  badge,
  cacheKey,
  onClose,
  onQuote,
}: {
  filePath: string;
  title: string;
  badge: string;
  cacheKey?: number | string;
  onClose?: () => void;
  onQuote?: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const src = `/v1/files/raw?path=${encodeURIComponent(filePath)}`;

  useEffect(() => {
    setFailed(false);
  }, [filePath, cacheKey]);

  return (
    <div className="file-preview file-preview--image">
      <PreviewHeader
        title={title}
        filePath={filePath}
        badge={badge}
        onClose={onClose}
        onQuote={onQuote}
      />
      {failed ? (
        <div className="file-preview-empty">
          <p className="file-preview-empty__title">无法加载预览</p>
          <p className="file-preview-empty__hint">
            图片无法显示，文件可能尚未写完、不是有效 PNG，或 host 暂时不可用
          </p>
        </div>
      ) : (
        <div className="file-preview-media file-preview-media--image">
          <img
            key={`${filePath}:${cacheKey ?? ""}`}
            className="file-preview-image"
            src={src}
            alt={title}
            loading="lazy"
            decoding="async"
            onError={() => setFailed(true)}
          />
        </div>
      )}
    </div>
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

export function FilePreviewContent({
  filePath,
  kind,
  text,
  cacheKey,
  onClose,
  onQuote,
  onExported,
}: Props) {
  const title = filePath ? basename(filePath) : "文件预览";
  const badge = previewBadge(filePath, kind);
  const isHtml = filePath ? isHtmlFilePath(filePath) : false;
  const exportAction = filePath ? (
    <ExportFormatButton filePath={filePath} onExported={onExported} />
  ) : null;
  const safeHtmlAction =
    isHtml && filePath ? <SafeHtmlOpenButton filePath={filePath} /> : null;
  const headerActions = (
    <>
      {exportAction}
      {safeHtmlAction}
    </>
  );

  if (kind === "spreadsheet" && filePath) {
    return (
      <SpreadsheetPreview
        filePath={filePath}
        title={title}
        onClose={onClose}
        onQuote={onQuote}
        onExported={onExported}
      />
    );
  }

  if ((kind === "audio" || kind === "video") && filePath) {
    const src = `/v1/files/raw?path=${encodeURIComponent(filePath)}`;
    return (
      <div className={`file-preview file-preview--${kind}`}>
        <PreviewHeader title={title} filePath={filePath} badge={badge} onClose={onClose} onQuote={onQuote} />
        <div className={`file-preview-media file-preview-media--${kind}`}>
          {kind === "audio" ? (
            <audio
              className="file-preview-audio"
              src={src}
              controls
              preload="metadata"
            />
          ) : (
            <video
              className="file-preview-video"
              src={src}
              controls
              preload="metadata"
              playsInline
            />
          )}
        </div>
      </div>
    );
  }

  if (kind === "image" && filePath) {
    return (
      <ImageFilePreview
        filePath={filePath}
        title={title}
        badge={badge}
        cacheKey={cacheKey}
        onClose={onClose}
        onQuote={onQuote}
      />
    );
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
        onClose={onClose}
        onQuote={onQuote}
        onExported={onExported}
      />
    );
  }

  if (kind === "error") {
    return (
      <div className="file-preview file-preview--error">
        <PreviewHeader title={title} badge={badge} onClose={onClose} onQuote={onQuote} />
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
        <PreviewHeader title={title} filePath={filePath} badge={badge} actions={headerActions} onClose={onClose} onQuote={onQuote} />
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
          actions={headerActions}
          onClose={onClose} onQuote={onQuote}
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
          actions={headerActions}
          onClose={onClose} onQuote={onQuote}
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
        actions={headerActions}
        onClose={onClose} onQuote={onQuote}
      />
      <pre className="file-preview-code">
        <code>{text}</code>
      </pre>
    </div>
  );
}
