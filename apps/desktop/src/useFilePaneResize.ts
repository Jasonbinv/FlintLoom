import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import {
  clampFilePaneWidth,
  FILE_PANE_DEFAULT_WIDTH,
  loadFilePaneWidth,
  saveFilePaneWidth,
} from "./filePaneWidth.ts";

type Options = {
  stageRef: RefObject<HTMLElement | null>;
  enabled: boolean;
};

export function useFilePaneResize({ stageRef, enabled }: Options) {
  const [width, setWidth] = useState(() => loadFilePaneWidth());
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const widthRef = useRef(width);
  widthRef.current = width;

  const measureStageWidth = useCallback(() => {
    const stage = stageRef.current;
    return stage?.getBoundingClientRect().width ?? window.innerWidth;
  }, [stageRef]);

  const clampWidth = useCallback(
    (value: number) => clampFilePaneWidth(value, measureStageWidth()),
    [measureStageWidth],
  );

  const syncWidthToStage = useCallback(() => {
    setWidth((prev) => {
      const next = clampWidth(prev);
      widthRef.current = next;
      return prev === next ? prev : next;
    });
  }, [clampWidth]);

  useEffect(() => {
    if (!enabled) return;
    syncWidthToStage();

    const onResize = () => syncWidthToStage();
    window.addEventListener("resize", onResize);

    const stage = stageRef.current;
    const observer =
      typeof ResizeObserver !== "undefined" && stage
        ? new ResizeObserver(onResize)
        : null;
    if (stage) observer?.observe(stage);

    return () => {
      window.removeEventListener("resize", onResize);
      observer?.disconnect();
    };
  }, [enabled, stageRef, syncWidthToStage]);

  const endDrag = useCallback(() => {
    dragRef.current = null;
    setDragging(false);
    const next = clampWidth(widthRef.current);
    setWidth(next);
    saveFilePaneWidth(next);
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
      const delta = dragRef.current.startX - event.clientX;
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
    defaultWidth: FILE_PANE_DEFAULT_WIDTH,
  };
}
