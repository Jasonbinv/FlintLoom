import { useEffect, useRef, useState } from "react";
import { Infographic } from "@antv/infographic";

type Props = {
  syntax: string;
};

export function AntvInfographicView({ syntax }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || !syntax) return;
    setFailed(false);
    let engine: Infographic | undefined;
    try {
      engine = new Infographic({
        container: el,
        width: "100%",
        height: 420,
        editable: false,
      });
      engine.render(syntax);
    } catch {
      setFailed(true);
    }
    return () => {
      try {
        engine?.destroy();
      } catch {
        // jsdom / HMR may already have detached the node
      }
    };
  }, [syntax]);

  return (
    <div
      className="a2ui-infographic a2ui-infographic--antv"
      data-syntax={syntax}
      ref={ref}
    >
      {failed ? <span className="a2ui-infographic-failed">failed</span> : null}
    </div>
  );
}