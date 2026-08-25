import type { PointerEvent as ReactPointerEvent } from "react";

type Props = {
  className?: string;
  ariaLabel?: string;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void;
};

export function FilePaneResizeHandle({
  className = "file-pane-resize-handle",
  ariaLabel = "调整工作区文件面板宽度",
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
      aria-orientation="vertical"
      aria-label={ariaLabel}
      title="拖动调整宽度"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    />
  );
}
