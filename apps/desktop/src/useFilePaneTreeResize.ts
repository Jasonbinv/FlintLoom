import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import {
  clampFilePaneTreeWidth,
  loadFilePaneTreeWidth,
  saveFilePaneTreeWidth,
} from "./filePaneTreeWidth.ts";

type Options = {
  bodyRef: RefObject<HTMLElement | null>;
  enabled: boolean;
};

export function useFilePaneTreeResize({ bodyRef, enabled }: Options) {
  const [width, setWidth] = useState(() => loadFilePaneTreeWidth());
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const widthRef = useRef(width);
  widthRef.current = width;

  const measureBodyWidth = useCallback(() => {
    const body = bodyRef.current;
    return body?.getBoundingClientRect().width ?? 0;
  }, [bodyRef]);

  const clampWidth = useCallback(
    (value: number) => clampFilePaneTreeWidth(value, measureBodyWidth()),
    [measureBodyWidth],
  );

  const syncWidthToBody = useCallback(() => {
    setWidth((prev) => {
      const next = clampWidth(prev);
      widthRef.current = next;
      return prev === next ? prev : next;
    });
  }, [clampWidth]);

  useEffect(() => {
    if (!enabled) return;
    syncWidthToBody();

    const onResize = () => syncWidthToBody();
    window.addEventListener("resize", onResize);

    const body = bodyRef.current;
    const observer =
      typeof ResizeObserver !== "undefined" && body
        ? new ResizeObserver(onResize)
        : null;
    if (body) observer?.observe(body);

    return () => {
      window.removeEventListener("resize", onResize);
      observer?.disconnect();
    };
  }, [bodyRef, enabled, syncWidthToBody]);

  const endDrag = useCallback(() => {
    dragRef.current = null;
    setDragging(false);
    const next = clampWidth(widthRef.current);
    setWidth(next);
    saveFilePaneTreeWidth(next);
  }, [clampWidth]);

  const onHandlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!enabled) return;
      event.preventDefault();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // jsdom may not implement pointer capture
      }
      dragRef.current = { startX: event.clientX, startWidth: width };
      setDragging(true);
    },
    [enabled, width],
  );

  const onHandlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!dragRef.current) return;
      const delta = event.clientX - dragRef.current.startX;
      const next = clampWidth(dragRef.current.startWidth + delta);
      widthRef.current = next;
      setWidth(next);
    },
    [clampWidth],
  );

  const onHandlePointerUp = useCallback(() => {
    endDrag();
  }, [endDrag]);

  return {
    width,
    dragging,
    onHandlePointerDown,
    onHandlePointerMove,
    onHandlePointerUp,
    onHandlePointerCancel: onHandlePointerUp,
  };
}
