import type { PointerEvent as ReactPointerEvent } from "react";

type Props = {
  className?: string;
  ariaLabel?: string;
  title?: string;
  orientation?: "vertical" | "horizontal";
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void;
};

export function FilePaneResizeHandle({
  className = "file-pane-resize-handle",
  ariaLabel = "调整工作区文件面板宽度",
  title = "拖动调整宽度",
  orientation = "vertical",
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: Props) {
  return (
    <button
      type="button"
      className={className}
      role="separator"
      aria-orientation={orientation}
      aria-label={ariaLabel}
      title={title}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    />
  );
}
