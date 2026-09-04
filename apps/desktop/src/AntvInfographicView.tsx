import { useEffect, useRef, useState } from "react";
import { Infographic } from "@antv/infographic";
import { repairAntvSyntax } from "@flintloom/infographic";

type Props = {
  syntax: string;
};

/** Cap so ultra-wide panes do not inflate AntV layout. Typical chat column is well below this. */
export const ANTV_DESIGN_MAX_WIDTH = 640;
export const ANTV_FIT_MAX_HEIGHT_PX = 640;
const ANTV_DESIGN_FALLBACK_WIDTH = 520;

export function antvDesignWidth(clientWidth: number): number {
  if (!Number.isFinite(clientWidth) || clientWidth <= 0) return ANTV_DESIGN_FALLBACK_WIDTH;
  return Math.min(Math.max(Math.floor(clientWidth), 280), ANTV_DESIGN_MAX_WIDTH);
}

/** Fill available width first; only shrink (keeping aspect) when the result would exceed max height. */
export function infographicFitSize(
  intrinsicW: number,
  intrinsicH: number,
  availW: number,
  maxH: number,
): { width: number; height: number } {
  if (intrinsicW <= 0 || intrinsicH <= 0) {
    return { width: availW > 0 ? availW : 0, height: 0 };
  }
  const paneW = availW > 0 ? availW : intrinsicW;
  const capH = maxH > 0 ? maxH : intrinsicH;
  let width = paneW;
  let height = intrinsicH * (paneW / intrinsicW);
  if (height > capH) {
    height = capH;
    width = intrinsicW * (capH / intrinsicH);
  }
  return { width, height };
}

function parsePx(raw: string | null): number {
  if (!raw) return 0;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

function svgIntrinsicSize(svg: SVGElement): { width: number; height: number } {
  const attrW = parsePx(svg.getAttribute("width"));
  const attrH = parsePx(svg.getAttribute("height"));
  const vb = svg.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  const vbW = vb && vb.length >= 4 && (vb[2] ?? 0) > 0 ? (vb[2] as number) : 0;
  const vbH = vb && vb.length >= 4 && (vb[3] ?? 0) > 0 ? (vb[3] as number) : 0;
  // Prefer viewBox: width/height attributes are overwritten with the display size.
  return {
    width: vbW || attrW || svg.clientWidth || ANTV_DESIGN_FALLBACK_WIDTH,
    height: vbH || attrH || svg.clientHeight || 240,
  };
}

function availableFitBox(host: HTMLElement): { width: number; maxHeight: number } {
  const shell = host.parentElement;
  const width = shell?.clientWidth || host.clientWidth || 0;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const maxHeight = Math.min(vh * 0.65, ANTV_FIT_MAX_HEIGHT_PX);
  return { width, maxHeight };
}

export function fitAntvSvg(host: HTMLElement): void {
  const svg = host.querySelector("svg");
  if (!svg) return;

  const { width: iw, height: ih } = svgIntrinsicSize(svg);
  const { width: aw, maxHeight: ah } = availableFitBox(host);
  const fitted = infographicFitSize(iw, ih, aw, ah);

  svg.setAttribute("width", `${fitted.width}`);
  svg.setAttribute("height", `${fitted.height}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.style.width = `${fitted.width}px`;
  svg.style.height = `${fitted.height}px`;
  svg.style.maxWidth = "100%";
  svg.style.maxHeight = "none";
  svg.style.overflow = "visible";

  host.style.width = `${fitted.width}px`;
  host.style.height = `${fitted.height}px`;
  host.style.transform = "";
  host.style.overflow = "visible";

  const shell = host.parentElement;
  if (shell) {
    shell.style.height = `${Math.ceil(fitted.height)}px`;
    shell.style.overflow = "visible";
  }
}

export function AntvInfographicView({ syntax }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || !syntax.trim()) {
      setFailed(true);
      return;
    }
    const repaired = repairAntvSyntax(syntax);
    let engine: Infographic | undefined;
    const onReady = () => {
      const painted = Boolean(el.querySelector("svg, canvas"));
      if (painted) {
        setFailed(false);
        fitAntvSvg(el);
      }
    };
    try {
      el.style.width = "100%";
      engine = new Infographic({
        container: el,
        width: antvDesignWidth(el.clientWidth || el.parentElement?.clientWidth || 0),
        padding: 24,
        editable: false,
      });
      engine.on("rendered", onReady);
      engine.on("loaded", onReady);
      engine.render(repaired);
    } catch {
      setFailed(true);
      return () => {
        try {
          engine?.destroy();
        } catch {
          // jsdom / HMR may already have detached the node
        }
      };
    }
    const painted = Boolean(el.querySelector("svg, canvas"));
    setFailed(!painted);
    if (painted) fitAntvSvg(el);
    const shell = el.parentElement;
    const observer =
      typeof ResizeObserver !== "undefined" && shell
        ? new ResizeObserver(() => fitAntvSvg(el))
        : null;
    if (shell) observer?.observe(shell);
    return () => {
      observer?.disconnect();
      try {
        engine?.off("rendered", onReady);
        engine?.off("loaded", onReady);
        engine?.destroy();
      } catch {
        // jsdom / HMR may already have detached the node
      }
    };
  }, [syntax]);

  return (
    <>
      {failed ? <p className="a2ui-fallback">信息图无法显示</p> : null}
      <div className="a2ui-infographic-fit" hidden={failed}>
        <div
          className="a2ui-infographic a2ui-infographic--antv"
          data-syntax={syntax}
          ref={ref}
        />
      </div>
    </>
  );
}
