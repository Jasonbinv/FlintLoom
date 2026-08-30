import { useEffect, useState } from "react";
import { renderSvg, type InfographicDocument } from "@flintloom/infographic";
import { AntvInfographicView } from "./AntvInfographicView.tsx";
import { fetchPreview } from "./files.ts";

type Props = {
  document?: InfographicDocument;
  file?: string;
  syntax?: string;
};

export function InfographicView({ document, file, syntax }: Props) {
  const [svg, setSvg] = useState<string | null>(null);
  const [antvSyntax, setAntvSyntax] = useState<string | null>(syntax ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (syntax) {
      setAntvSyntax(syntax);
      setSvg(null);
      setFailed(false);
      return;
    }
    setAntvSyntax(null);
    if (document) {
      try {
        setSvg(renderSvg(document));
        setFailed(false);
      } catch {
        setSvg(null);
        setFailed(true);
      }
      return;
    }
    if (!file) return;
    const ac = new AbortController();
    void fetchPreview(file, ac.signal)
      .then((preview) => {
        if (ac.signal.aborted) return;
        if (preview.kind === "svg") {
          setSvg(preview.text);
          setAntvSyntax(null);
          setFailed(false);
          return;
        }
        if (preview.kind === "antv") {
          setAntvSyntax(preview.text);
          setSvg(null);
          setFailed(false);
          return;
        }
        setSvg(null);
        setAntvSyntax(null);
        setFailed(true);
      })
      .catch(() => {
        if (!ac.signal.aborted) {
          setSvg(null);
          setAntvSyntax(null);
          setFailed(true);
        }
      });
    return () => ac.abort();
  }, [document, file, syntax]);

  if (failed) return <span className="a2ui-infographic-failed">failed</span>;
  if (antvSyntax) return <AntvInfographicView syntax={antvSyntax} />;
  if (!svg) return <span className="a2ui-infographic-loading">…</span>;
  return (
    <div
      className="a2ui-infographic"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}