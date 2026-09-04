import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const VIEWPORT_PADDING = 8;
const POPOVER_MIN_WIDTH = 160;

export type FileTreeContextMenuState<T> = {
  node: T;
  x: number;
  y: number;
} | null;

type Props = {
  open: boolean;
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
};

/** Portaled context menu for workspace file tree rows. */
export function FileTreeContextMenu({ open, x, y, onClose, children }: Props) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    setPosition({
      left: Math.max(
        VIEWPORT_PADDING,
        Math.min(
          x,
          window.innerWidth -
            Math.max(rect.width, POPOVER_MIN_WIDTH) -
            VIEWPORT_PADDING,
        ),
      ),
      top: Math.max(
        VIEWPORT_PADDING,
        Math.min(y, window.innerHeight - rect.height - VIEWPORT_PADDING),
      ),
    });
  }, [children, open, x, y]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      onClose();
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onEscape);
    };
  }, [onClose, open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={menuRef}
      className="file-tree-context-menu"
      style={{ position: "fixed", left: position.left, top: position.top }}
      role="menu"
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}
