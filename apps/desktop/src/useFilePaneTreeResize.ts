import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import {
  clampFilePaneTreeHeight,
  loadFilePaneTreeHeight,
  saveFilePaneTreeHeight,
} from "./filePaneTreeHeight.ts";

type Options = {
  bodyRef: RefObject<HTMLElement | null>;
  enabled: boolean;
};

export function useFilePaneTreeResize({ bodyRef, enabled }: Options) {
  const [height, setHeight] = useState(() => loadFilePaneTreeHeight());
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const heightRef = useRef(height);
  heightRef.current = height;

  const measureBodyHeight = useCallback(() => {
    const body = bodyRef.current;
    return body?.getBoundingClientRect().height ?? 0;
  }, [bodyRef]);

  const clampHeight = useCallback(
    (value: number) => clampFilePaneTreeHeight(value, measureBodyHeight()),
    [measureBodyHeight],
  );

  const syncHeightToBody = useCallback(() => {
    setHeight((prev) => {
      const next = clampHeight(prev);
      heightRef.current = next;
      return prev === next ? prev : next;
    });
  }, [clampHeight]);

  useEffect(() => {
    if (!enabled) return;
    syncHeightToBody();

    const onResize = () => syncHeightToBody();
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
  }, [bodyRef, enabled, syncHeightToBody]);

  const endDrag = useCallback(() => {
    dragRef.current = null;
    setDragging(false);
    const next = clampHeight(heightRef.current);
    setHeight(next);
    saveFilePaneTreeHeight(next);
  }, [clampHeight]);

  const onHandlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!enabled) return;
      event.preventDefault();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // jsdom may not implement pointer capture
      }
      dragRef.current = { startY: event.clientY, startHeight: height };
      setDragging(true);
    },
    [enabled, height],
  );

  const onHandlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!dragRef.current) return;
      const delta = event.clientY - dragRef.current.startY;
      const next = clampHeight(dragRef.current.startHeight + delta);
      heightRef.current = next;
      setHeight(next);
    },
    [clampHeight],
  );

  const onHandlePointerUp = useCallback(() => {
    endDrag();
  }, [endDrag]);

  return {
    height,
    dragging,
    onHandlePointerDown,
    onHandlePointerMove,
    onHandlePointerUp,
    onHandlePointerCancel: onHandlePointerUp,
  };
}
