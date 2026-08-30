import { useEffect, useRef, useState } from "react";
import { Infographic } from "@antv/infographic";
import { repairAntvSyntax } from "@flintloom/infographic";

type Props = {
  syntax: string;
};

export function fitAntvSvg(host: HTMLElement): void {
  const svg = host.querySelector("svg");
  if (!svg) return;
  if (!svg.getAttribute("viewBox")) {
    try {
      const box = svg.getBBox();
      if (box.width > 0 && box.height > 0) {
        svg.setAttribute("viewBox", `${box.x} ${box.y} ${box.width} ${box.height}`);
      }
    } catch {
      // jsdom / detached nodes may not implement getBBox
    }
  }
  svg.removeAttribute("height");
  svg.setAttribute("width", "100%");
  svg.setAttribute("preserveAspectRatio", "xMidYMin meet");
  svg.style.width = "100%";
  svg.style.height = "auto";
  svg.style.maxWidth = "100%";
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
      fitAntvSvg(el);
    };
    try {
      const width = Math.max(el.clientWidth, 320);
      engine = new Infographic({
        container: el,
        width,
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
    return () => {
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
      <div
        className="a2ui-infographic a2ui-infographic--antv"
        data-syntax={syntax}
        hidden={failed}
        ref={ref}
      />
    </>
  );
}
