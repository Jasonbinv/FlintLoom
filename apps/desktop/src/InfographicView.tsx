import { useEffect, useState } from "react";
import { renderSvg, type InfographicDocument } from "@flintloom/infographic";
import { fetchPreview } from "./files.ts";

type Props = {
  document?: InfographicDocument;
  file?: string;
};

export function InfographicView({ document, file }: Props) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
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
          setFailed(false);
        } else {
          setSvg(null);
          setFailed(true);
        }
      })
      .catch(() => {
        if (!ac.signal.aborted) {
          setSvg(null);
          setFailed(true);
        }
      });
    return () => ac.abort();
  }, [document, file]);

  if (failed) return <span className="a2ui-infographic-failed">failed</span>;
  if (!svg) return <span className="a2ui-infographic-loading">…</span>;
  return (
    <div
      className="a2ui-infographic"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
