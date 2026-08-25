import { useEffect, useRef, useState } from "react";
import { renderAsync } from "docx-preview";

type Props = {
  arrayBuffer: ArrayBuffer;
};

const DOCX_SCALE_HORIZONTAL_PADDING_PX = 16;

function parseCssLengthToPx(value: string, context: HTMLElement): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  if (trimmed.endsWith("px")) {
    const px = Number.parseFloat(trimmed);
    return Number.isFinite(px) ? px : 0;
  }
  const probe = document.createElement("div");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.width = trimmed;
  context.appendChild(probe);
  const px = probe.offsetWidth;
  probe.remove();
  return px;
}

function getDocxWrapper(root: HTMLElement): HTMLElement | null {
  return root.querySelector(".file-docx-scale-stage .docx-wrapper");
}

function getDocxSections(root: HTMLElement): HTMLElement[] {
  const wrapper = getDocxWrapper(root);
  if (!wrapper) return [];
  return Array.from(
    wrapper.querySelectorAll(
      ":scope > section.docx, :scope > .file-docx-page-frame > section.docx",
    ),
  ) as HTMLElement[];
}

function resolveDocxNaturalWidthPx(root: HTMLElement): number {
  const cached = root.style.getPropertyValue("--file-docx-natural-width");
  if (cached) {
    const px = parseCssLengthToPx(cached, root);
    if (px > 0) return px;
  }

  for (const section of getDocxSections(root)) {
    if (!section.style.width) continue;
    const px = parseCssLengthToPx(section.style.width, root);
    if (px > 0) {
      root.style.setProperty("--file-docx-natural-width", `${px}px`);
      return px;
    }
  }

  const stage = root.querySelector(".file-docx-scale-stage") as HTMLElement | null;
  const prevStageWidth = stage?.style.width ?? "";
  if (stage) {
    stage.style.width = "max-content";
  }
  const wrapper = getDocxWrapper(root);
  const measured = wrapper?.scrollWidth ?? 0;
  if (stage) {
    stage.style.width = prevStageWidth;
  }
  if (measured > 0) {
    root.style.setProperty("--file-docx-natural-width", `${measured}px`);
  }
  return measured;
}

function resetDocxScale(root: HTMLElement) {
  const stage = root.querySelector(".file-docx-scale-stage") as HTMLElement | null;
  if (!stage) return;
  stage.style.transform = "none";
  stage.style.width = "";
  stage.style.margin = "";
  stage.style.marginBottom = "";
}

function applyDocxFitScale(root: HTMLElement): boolean {
  const viewport = root.querySelector(".file-docx-scale-viewport") as HTMLElement | null;
  const stage = root.querySelector(".file-docx-scale-stage") as HTMLElement | null;
  const wrapper = getDocxWrapper(root);
  if (!viewport || !stage || !wrapper) return true;

  resetDocxScale(root);

  const viewportWidth = viewport.clientWidth;
  if (viewportWidth <= 0) return false;

  const naturalWidth = resolveDocxNaturalWidthPx(root);
  if (naturalWidth <= 0) return false;

  const availableWidth = Math.max(160, viewportWidth - DOCX_SCALE_HORIZONTAL_PADDING_PX);
  const scale = Math.min(1, availableWidth / naturalWidth);

  stage.style.width = `${naturalWidth}px`;
  stage.style.margin = "0 auto";
  root.classList.add("file-docx-wrap--scaled");

  if (scale >= 0.999) {
    stage.style.transform = "none";
    stage.style.marginBottom = "";
    root.style.setProperty("--file-docx-scale", "1");
    return true;
  }

  const naturalHeight = wrapper.offsetHeight;
  stage.style.transform = `scale(${scale})`;
  stage.style.transformOrigin = "top center";
  stage.style.marginBottom = `${-Math.round(naturalHeight * (1 - scale))}px`;
  root.style.setProperty("--file-docx-scale", scale.toFixed(4));
  return true;
}

function waitForLayout(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function decorateDocxPages(root: HTMLElement) {
  root
    .querySelectorAll(
      ".file-docx-page-separator, .file-docx-page-indicator, .file-docx-page-frame",
    )
    .forEach((node) => node.remove());
  root.querySelectorAll(".file-docx-page").forEach((page) =>
    page.classList.remove("file-docx-page"),
  );

  const wrapper = getDocxWrapper(root);
  if (!wrapper) {
    root.classList.remove("file-docx-wrap--paginated");
    return;
  }

  const sections = Array.from(
    wrapper.querySelectorAll(":scope > section.docx"),
  ) as HTMLElement[];
  if (sections.length === 0) {
    root.classList.remove("file-docx-wrap--paginated");
    return;
  }

  const total = sections.length;
  sections.forEach((page, index) => {
    const frame = document.createElement("div");
    frame.className = "file-docx-page-frame";
    wrapper.insertBefore(frame, page);
    frame.appendChild(page);
    page.classList.add("file-docx-page");

    if (index > 0) {
      const separator = document.createElement("div");
      separator.className = "file-docx-page-separator";
      separator.setAttribute("aria-hidden", "true");
      wrapper.insertBefore(separator, frame);
    }

    const indicator = document.createElement("div");
    indicator.className = "file-docx-page-indicator";
    indicator.setAttribute("aria-hidden", "true");
    indicator.textContent = `第 ${index + 1} / ${total} 页`;
    frame.appendChild(indicator);
  });

  root.classList.add("file-docx-wrap--paginated");
}

function injectDocxThemeOverrides(stage: HTMLElement) {
  if (stage.querySelector("style[data-file-docx-theme]")) return;
  const style = document.createElement("style");
  style.setAttribute("data-file-docx-theme", "true");
  style.textContent = `
.file-docx-wrap .docx-wrapper,
.file-docx-wrap .file-docx-page-wrapper {
  background: var(--office-desk) !important;
  padding: 8px 0 16px !important;
}
.file-docx-wrap .docx-wrapper > section.docx,
.file-docx-wrap .file-docx-page-wrapper > section.file-docx-page,
.file-docx-wrap section.docx {
  background: var(--office-page) !important;
  color: var(--office-page-text) !important;
  box-shadow: none !important;
  margin-bottom: 0 !important;
}
`;
  stage.appendChild(style);
}

async function finalizeDocxPreview(root: HTMLElement) {
  const stage = root.querySelector(".file-docx-scale-stage");
  if (stage) injectDocxThemeOverrides(stage as HTMLElement);
  await waitForLayout();
  resolveDocxNaturalWidthPx(root);
  await waitForLayout();
  decorateDocxPages(root);
  await waitForLayout();
  if (!applyDocxFitScale(root)) {
    await waitForLayout();
    applyDocxFitScale(root);
  }
}

export function FileDocxPreview({ arrayBuffer }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [renderError, setRenderError] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    const stage = stageRef.current;
    if (!root || !stage) return;

    stage.replaceChildren();
    root.classList.remove("file-docx-wrap--paginated", "file-docx-wrap--scaled");
    root.style.removeProperty("--file-docx-scale");
    root.style.removeProperty("--file-docx-natural-width");
    resetDocxScale(root);
    setRenderError(false);
    let cancelled = false;

    const syncScale = () => {
      if (cancelled) return;
      if (!applyDocxFitScale(root)) {
        requestAnimationFrame(syncScale);
      }
    };

    void (async () => {
      try {
        await renderAsync(arrayBuffer, stage, undefined, {
          inWrapper: true,
          breakPages: true,
          ignoreLastRenderedPageBreak: false,
        });
        if (cancelled) return;
        await finalizeDocxPreview(root);
      } catch {
        if (!cancelled) setRenderError(true);
      }
    })();

    const viewport = root.querySelector(".file-docx-scale-viewport");
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
    };
  }, [arrayBuffer]);

  if (renderError) {
    return (
      <div className="file-office-error">
        <p>Word 文档解析失败，请下载后查看</p>
      </div>
    );
  }

  return (
    <div className="file-docx-wrap docx" ref={rootRef}>
      <div className="file-docx-scale-viewport">
        <div className="file-docx-scale-stage" ref={stageRef} />
      </div>
    </div>
  );
}
