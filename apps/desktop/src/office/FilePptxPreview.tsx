import { useEffect, useRef, useState } from "react";
import { PPTXViewer } from "pptxviewjs";

type Props = {
  arrayBuffer: ArrayBuffer;
};

const PPTX_NATURAL_WIDTH_PX = 960;
const PPTX_SCALE_HORIZONTAL_PADDING_PX = 16;

type ViewerWithSlideDims = PPTXViewer & {
  processor?: { getSlideDimensions?: () => { cx: number; cy: number } };
};

function getSlideCanvasSize(viewer: PPTXViewer) {
  const proc = (viewer as ViewerWithSlideDims).processor;
  const dims = proc?.getSlideDimensions?.() ?? { cx: 9144000, cy: 6858000 };
  const aspect = dims.cx / Math.max(dims.cy, 1);
  const width = PPTX_NATURAL_WIDTH_PX;
  const height = Math.max(120, Math.round(width / aspect));
  return { width, height };
}

function getPptxSlidesRoot(root: HTMLElement): HTMLElement | null {
  return root.querySelector(".file-pptx-scale-stage .file-pptx-slides");
}

function resolvePptxNaturalWidthPx(root: HTMLElement): number {
  const cached = root.style.getPropertyValue("--file-pptx-natural-width");
  if (cached) {
    const px = Number.parseFloat(cached);
    if (Number.isFinite(px) && px > 0) return px;
  }
  const slides = getPptxSlidesRoot(root);
  const measured = slides?.scrollWidth ?? 0;
  if (measured > 0) {
    root.style.setProperty("--file-pptx-natural-width", `${measured}px`);
  }
  return measured;
}

function resetPptxScale(root: HTMLElement) {
  const stage = root.querySelector(".file-pptx-scale-stage") as HTMLElement | null;
  if (!stage) return;
  stage.style.transform = "none";
  stage.style.width = "";
  stage.style.margin = "";
  stage.style.marginBottom = "";
}

function applyPptxFitScale(root: HTMLElement): boolean {
  const viewport = root.querySelector(".file-pptx-scale-viewport") as HTMLElement | null;
  const stage = root.querySelector(".file-pptx-scale-stage") as HTMLElement | null;
  const slides = getPptxSlidesRoot(root);
  if (!viewport || !stage || !slides) return true;

  resetPptxScale(root);

  const viewportWidth = viewport.clientWidth;
  if (viewportWidth <= 0) return false;

  const naturalWidth = resolvePptxNaturalWidthPx(root);
  if (naturalWidth <= 0) return false;

  const availableWidth = Math.max(160, viewportWidth - PPTX_SCALE_HORIZONTAL_PADDING_PX);
  const scale = Math.min(1, availableWidth / naturalWidth);

  stage.style.width = `${naturalWidth}px`;
  stage.style.margin = "0 auto";
  root.classList.add("file-pptx-wrap--scaled");

  if (scale >= 0.999) {
    stage.style.transform = "none";
    stage.style.marginBottom = "";
    root.style.setProperty("--file-pptx-scale", "1");
    return true;
  }

  const naturalHeight = slides.offsetHeight;
  stage.style.transform = `scale(${scale})`;
  stage.style.transformOrigin = "top center";
  stage.style.marginBottom = `${-Math.round(naturalHeight * (1 - scale))}px`;
  root.style.setProperty("--file-pptx-scale", scale.toFixed(4));
  return true;
}

function waitForLayout(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

export function FilePptxPreview({ arrayBuffer }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<PPTXViewer | null>(null);
  const [loading, setLoading] = useState(true);
  const [renderError, setRenderError] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    const stage = stageRef.current;
    if (!root || !stage) return;

    stage.replaceChildren();
    root.classList.remove("file-pptx-wrap--scaled");
    root.style.removeProperty("--file-pptx-scale");
    root.style.removeProperty("--file-pptx-natural-width");
    root.style.removeProperty("--file-pptx-slide-height");
    resetPptxScale(root);
    setLoading(true);
    setRenderError(false);
    let cancelled = false;

    const syncScale = () => {
      if (cancelled) return;
      if (!applyPptxFitScale(root)) {
        requestAnimationFrame(syncScale);
      }
    };

    const viewer = new PPTXViewer({ slideSizeMode: "fit", autoRenderFirstSlide: false });
    viewerRef.current = viewer;

    void (async () => {
      try {
        await viewer.loadFile(arrayBuffer);
        if (cancelled) return;

        const slideCount = viewer.getSlideCount();
        if (slideCount <= 0) {
          if (!cancelled) setRenderError(true);
          return;
        }
        const { width, height } = getSlideCanvasSize(viewer);
        root.style.setProperty("--file-pptx-natural-width", `${width}px`);
        root.style.setProperty("--file-pptx-slide-height", `${height}px`);

        const slidesEl = document.createElement("div");
        slidesEl.className = "file-pptx-slides";

        for (let index = 0; index < slideCount; index += 1) {
          if (index > 0) {
            const separator = document.createElement("div");
            separator.className = "file-pptx-page-separator";
            separator.setAttribute("aria-hidden", "true");
            slidesEl.appendChild(separator);
          }

          const frame = document.createElement("div");
          frame.className = "file-pptx-slide-frame";

          const canvas = document.createElement("canvas");
          canvas.className = "file-pptx-canvas";
          canvas.style.width = `${width}px`;
          canvas.style.height = `${height}px`;
          frame.appendChild(canvas);

          const indicator = document.createElement("div");
          indicator.className = "file-pptx-page-indicator";
          indicator.setAttribute("aria-hidden", "true");
          indicator.textContent = `第 ${index + 1} / ${slideCount} 页`;
          frame.appendChild(indicator);

          slidesEl.appendChild(frame);
          await viewer.renderSlide(index, canvas);
          if (cancelled) return;
        }

        stage.appendChild(slidesEl);
        root.classList.add("file-pptx-wrap--paginated");
        await waitForLayout();
        if (!applyPptxFitScale(root)) {
          await waitForLayout();
          applyPptxFitScale(root);
        }
      } catch {
        if (!cancelled) setRenderError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    const viewport = root.querySelector(".file-pptx-scale-viewport");
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => syncScale())
        : null;
    if (viewport) observer?.observe(viewport);
    observer?.observe(root);
    window.addEventListener("resize", syncScale);

    return () => {
      cancelled = true;
      observer?.disconnect();
      window.removeEventListener("resize", syncScale);
      try {
        viewer.destroy();
      } catch {
        /* noop */
      }
      if (viewerRef.current === viewer) viewerRef.current = null;
      stage.replaceChildren();
      root.classList.remove("file-pptx-wrap--paginated", "file-pptx-wrap--scaled");
    };
  }, [arrayBuffer]);

  if (renderError) {
    return (
      <div className="file-office-error">
        <p>演示文稿解析失败，请下载后查看</p>
      </div>
    );
  }

  return (
    <div className="file-pptx-wrap" ref={rootRef}>
      <div className="file-pptx-scale-viewport">
        {loading ? (
          <div className="file-office-loading" aria-busy="true">正在加载幻灯片…</div>
        ) : null}
        <div className="file-pptx-scale-stage" ref={stageRef} />
      </div>
    </div>
  );
}
