import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import {
  clampFilePreviewWidth,
  FILE_PREVIEW_DEFAULT_WIDTH,
  loadFilePreviewWidth,
  saveFilePreviewWidth,
} from "./filePanePreviewWidth.ts";

type Options = {
  stageRef: RefObject<HTMLElement | null>;
  treeWidth: number;
  enabled: boolean;
};

export function useFilePanePreviewResize({
  stageRef,
  treeWidth,
  enabled,
}: Options) {
  const [width, setWidth] = useState(() => loadFilePreviewWidth());
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const widthRef = useRef(width);
  widthRef.current = width;
  const treeWidthRef = useRef(treeWidth);
  treeWidthRef.current = treeWidth;

  const measureStageWidth = useCallback(() => {
    const stage = stageRef.current;
    return stage?.getBoundingClientRect().width ?? window.innerWidth;
  }, [stageRef]);

  const clampWidth = useCallback(
    (value: number) =>
      clampFilePreviewWidth(value, measureStageWidth(), treeWidthRef.current),
    [measureStageWidth],
  );

  const syncWidthToStage = useCallback(() => {
    setWidth((prev) => {
      const next = clampWidth(prev);
      widthRef.current = next;
      return prev === next ? prev : next;
    });
  }, [clampWidth]);

  useLayoutEffect(() => {
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
  }, [enabled, stageRef, syncWidthToStage, treeWidth]);

  const endDrag = useCallback(() => {
    dragRef.current = null;
    setDragging(false);
    const next = clampWidth(widthRef.current);
    setWidth(next);
    saveFilePreviewWidth(next);
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
    defaultWidth: FILE_PREVIEW_DEFAULT_WIDTH,
  };
}
