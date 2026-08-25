import {
  Component,
  forwardRef,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { FileXlsxLegacyHtmlPreview } from "./FileXlsxLegacyHtmlPreview.tsx";
import { isOleCompoundDocument } from "./officeBinaryProbe.ts";
import type { FileXlsxPreviewHandle } from "./types.ts";

const FileXlsxFortunePreview = lazy(() =>
  import("./FileXlsxFortunePreview.tsx").then((module) => ({
    default: module.FileXlsxFortunePreview,
  })),
);

type Props = {
  arrayBuffer: ArrayBuffer;
  fileName?: string;
  onDirtyChange?: () => void;
  editable?: boolean;
};

class FileXlsxFortuneErrorBoundary extends Component<
  { onFallback: () => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _errorInfo: ErrorInfo) {
    this.props.onFallback();
  }

  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

export const FileXlsxPreview = forwardRef<FileXlsxPreviewHandle, Props>(
  function FileXlsxPreview(
    { arrayBuffer, fileName, onDirtyChange, editable = true },
    ref,
  ) {
    const [useLegacy, setUseLegacy] = useState(() => {
      const lower = (fileName || "").trim().toLowerCase();
      return lower.endsWith(".csv") || lower.endsWith(".xls");
    });

    useEffect(() => {
      if (useLegacy) return;
      let cancelled = false;
      void (async () => {
        if (await isOleCompoundDocument(new Blob([arrayBuffer]))) {
          if (!cancelled) setUseLegacy(true);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [arrayBuffer, useLegacy]);

    const handleFallback = useCallback(() => setUseLegacy(true), []);

    if (useLegacy) {
      return (
        <FileXlsxLegacyHtmlPreview arrayBuffer={arrayBuffer} fileName={fileName} />
      );
    }

    return (
      <Suspense
        fallback={
          <div className="file-xlsx-fortune-loading" role="status" aria-live="polite">
            正在加载表格…
          </div>
        }
      >
        <FileXlsxFortuneErrorBoundary onFallback={handleFallback}>
          <FileXlsxFortunePreview
            ref={editable ? ref : undefined}
            arrayBuffer={arrayBuffer}
            fileName={fileName}
            onFallback={handleFallback}
            onDirtyChange={onDirtyChange}
            editable={editable}
          />
        </FileXlsxFortuneErrorBoundary>
      </Suspense>
    );
  },
);

export type { FileXlsxPreviewHandle } from "./types.ts";
