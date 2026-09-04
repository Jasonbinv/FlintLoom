import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  FilePreviewCloseButton,
  FilePreviewFullscreenButton,
  type FilePreviewChromeProps,
} from "./FilePreviewContent.tsx";
import { ExportFormatButton } from "./ExportFormatButton.tsx";
import {
  fetchFileBytes,
  fetchOfficeMarkdown,
  saveOfficeFromMarkdown,
} from "./files.ts";
import { renderMarkdownHtml } from "./markdownPreview.ts";
import { isZipContainer } from "./xlsx/officeBinaryProbe.ts";

const LazyFileDocxPreview = lazy(() =>
  import("./office/FileDocxPreview.tsx").then((module) => ({
    default: module.FileDocxPreview,
  })),
);
const LazyFilePptxPreview = lazy(() =>
  import("./office/FilePptxPreview.tsx").then((module) => ({
    default: module.FilePptxPreview,
  })),
);
const LazyPdfPreview = lazy(() =>
  import("./office/PdfPreview.tsx").then((module) => ({
    default: module.PdfPreview,
  })),
);

class OfficePreviewErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="file-office-error">
          <p>文档预览失败，请下载后查看</p>
        </div>
      );
    }
    return this.props.children;
  }
}

type OfficeKind = "pdf" | "docx" | "pptx";

type Props = FilePreviewChromeProps & {
  filePath: string;
  title: string;
  kind: OfficeKind;
  onExported?: (path: string) => void;
};

const BADGE: Record<OfficeKind, string> = {
  pdf: "PDF",
  docx: "Word",
  pptx: "PPT",
};

export function DocumentPreview({
  filePath,
  title,
  kind,
  onClose,
  onQuote,
  onExported,
  fullscreen,
  onToggleFullscreen,
}: Props) {
  const [tab, setTab] = useState<"preview" | "edit">("preview");
  const [arrayBuffer, setArrayBuffer] = useState<ArrayBuffer>();
  const [bytesError, setBytesError] = useState<string>();
  const [bytesLoading, setBytesLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  const [markdown, setMarkdown] = useState("");
  const [draft, setDraft] = useState("");
  const [markdownLoading, setMarkdownLoading] = useState(false);
  const [markdownError, setMarkdownError] = useState<string>();
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const [legacyUnsupported, setLegacyUnsupported] = useState(false);

  const reload = useCallback(() => {
    setReloadKey((key) => key + 1);
    setTab("preview");
    setDirty(false);
    setSaveError(undefined);
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    setBytesLoading(true);
    setBytesError(undefined);
    setArrayBuffer(undefined);
    setLegacyUnsupported(false);
    void fetchFileBytes(filePath, ac.signal)
      .then(async (bytes) => {
        if (ac.signal.aborted) return;
        const lower = filePath.toLowerCase();
        if (
          (lower.endsWith(".doc") || lower.endsWith(".ppt")) &&
          !(await isZipContainer(new Blob([bytes])))
        ) {
          setLegacyUnsupported(true);
          return;
        }
        setArrayBuffer(bytes);
      })
      .catch(() => {
        if (!ac.signal.aborted) setBytesError("无法加载文件");
      })
      .finally(() => {
        if (!ac.signal.aborted) setBytesLoading(false);
      });
    return () => ac.abort();
  }, [filePath, reloadKey]);

  useEffect(() => {
    if (tab !== "edit") return;
    const ac = new AbortController();
    setMarkdownLoading(true);
    setMarkdownError(undefined);
    void fetchOfficeMarkdown(filePath, ac.signal)
      .then((text) => {
        if (!ac.signal.aborted) {
          setMarkdown(text);
          if (!dirty) setDraft(text);
        }
      })
      .catch(() => {
        if (!ac.signal.aborted) setMarkdownError("无法加载可编辑文本");
      })
      .finally(() => {
        if (!ac.signal.aborted) setMarkdownLoading(false);
      });
    return () => ac.abort();
  }, [filePath, reloadKey, tab, dirty]);

  async function handleSave() {
    if (!dirty || saving) return;
    setSaving(true);
    setSaveError(undefined);
    try {
      await saveOfficeFromMarkdown(filePath, draft);
      setMarkdown(draft);
      setDirty(false);
      reload();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  function handleDiscard() {
    setDraft(markdown);
    setDirty(false);
    setSaveError(undefined);
  }

  const previewBody = (() => {
    if (bytesLoading) {
      return <div className="file-office-loading" role="status">正在加载文档…</div>;
    }
    if (legacyUnsupported) {
      return (
        <div className="file-office-error">
          <p>旧版 .doc / .ppt 格式请先在 Office 中另存为 .docx / .pptx</p>
        </div>
      );
    }
    if (bytesError || !arrayBuffer) {
      return (
        <div className="file-office-error">
          <p>{bytesError ?? "加载失败"}</p>
        </div>
      );
    }

    return (
      <OfficePreviewErrorBoundary key={`${filePath}:${kind}:${reloadKey}`}>
        <Suspense fallback={<div className="file-office-loading">正在渲染…</div>}>
          {kind === "pdf" ? (
            <LazyPdfPreview arrayBuffer={arrayBuffer} />
          ) : kind === "docx" ? (
            <LazyFileDocxPreview arrayBuffer={arrayBuffer} />
          ) : (
            <LazyFilePptxPreview arrayBuffer={arrayBuffer} />
          )}
        </Suspense>
      </OfficePreviewErrorBoundary>
    );
  })();

  const editBody = (() => {
    if (markdownLoading) {
      return <div className="file-office-loading" role="status">正在解析文档…</div>;
    }
    if (markdownError) {
      return (
        <div className="file-office-error">
          <p>{markdownError}</p>
        </div>
      );
    }
    return (
      <div className="file-office-edit">
        <textarea
          className="file-office-edit__textarea"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setDirty(event.target.value !== markdown);
          }}
        />
        <article
          className="file-preview-prose file-office-edit__preview"
          dangerouslySetInnerHTML={{ __html: renderMarkdownHtml(draft) }}
        />
      </div>
    );
  })();

  return (
    <div className="file-preview file-preview--office">
      <header className="file-preview-header">
        <span className="file-preview-header__name" title={filePath}>
          {title}
        </span>
        <div className="file-preview-header__actions">
          <ExportFormatButton filePath={filePath} onExported={onExported} />
          <div className="file-preview-header__action-wrap">
            <button
              type="button"
              className={`file-preview-header__action${tab === "preview" ? " file-preview-header__action--active" : ""}`}
              onClick={() => setTab("preview")}
            >
              预览
            </button>
            <button
              type="button"
              className={`file-preview-header__action${tab === "edit" ? " file-preview-header__action--active" : ""}`}
              onClick={() => setTab("edit")}
            >
              编辑
            </button>
            {tab === "edit" && dirty ? (
              <>
                <button
                  type="button"
                  className="file-preview-header__action"
                  disabled={saving}
                  onClick={() => void handleSave()}
                >
                  {saving ? "保存中…" : "保存"}
                </button>
                <button
                  type="button"
                  className="file-preview-header__action file-preview-header__action--ghost"
                  disabled={saving}
                  onClick={handleDiscard}
                >
                  放弃
                </button>
              </>
            ) : null}
            {saveError ? (
              <span className="file-preview-header__action-error">{saveError}</span>
            ) : null}
          </div>
          {onQuote ? (
            <button
              type="button"
              className="file-preview-header__action"
              onClick={onQuote}
              title="引用到对话"
            >
              引用
            </button>
          ) : null}
          <span className="file-preview-header__badge">{BADGE[kind]}</span>
          <FilePreviewFullscreenButton
            fullscreen={fullscreen}
            onToggleFullscreen={onToggleFullscreen}
          />
          {onClose ? <FilePreviewCloseButton onClose={onClose} /> : null}
        </div>
      </header>
      <div className="file-office-body">
        {tab === "preview" ? previewBody : editBody}
      </div>
    </div>
  );
}
