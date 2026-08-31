import { useCallback, useRef, useState, type DragEvent } from "react";
import type { FileTreeNode } from "./FileTreeNodeActions.tsx";
import { resolveTreeDropDestination } from "./files.ts";

const FILE_TREE_DRAG_MIME = "application/x-flintloom-entry";
const EXPAND_HOVER_MS = 450;

type DragPayload = {
  path: string;
  name: string;
  type: "file" | "dir";
};

type BindProps = {
  draggable: boolean;
  className: string;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onDragEnter: (event: DragEvent<HTMLButtonElement>) => void;
  onDragOver: (event: DragEvent<HTMLButtonElement>) => void;
  onDragLeave: (event: DragEvent<HTMLButtonElement>) => void;
  onDrop: (event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
  onClickCapture: (event: { preventDefault: () => void; stopPropagation: () => void }) => void;
};

function payloadFromNode(node: FileTreeNode): DragPayload {
  return { path: node.path, name: node.name, type: node.type };
}

function readDragPayload(
  event: DragEvent<HTMLButtonElement>,
  fallback: DragPayload | null,
): DragPayload | null {
  if (fallback) return fallback;
  const raw =
    event.dataTransfer?.getData(FILE_TREE_DRAG_MIME) ||
    event.dataTransfer?.getData("text/plain");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as DragPayload;
    if (
      typeof parsed.path === "string" &&
      typeof parsed.name === "string" &&
      (parsed.type === "file" || parsed.type === "dir")
    ) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

function destinationForHover(source: DragPayload, hover: FileTreeNode): string | null {
  return resolveTreeDropDestination(
    source.path,
    source.type === "dir",
    hover.path,
    hover.type === "dir",
  );
}

export function useFileTreeDragMove(opts: {
  onMove: (source: FileTreeNode, dest: string) => void | Promise<void>;
  onExpandFolder: (path: string) => void;
  isFolderExpanded: (path: string) => boolean;
}): {
  bindRow: (node: FileTreeNode) => BindProps;
  draggingPath: string | null;
  dropOverPath: string | null;
} {
  const sourceRef = useRef<DragPayload | null>(null);
  const didDragRef = useRef(false);
  const expandTimerRef = useRef<number>(0);
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const [dropOverPath, setDropOverPath] = useState<string | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const clearExpandTimer = useCallback(() => {
    window.clearTimeout(expandTimerRef.current);
    expandTimerRef.current = 0;
  }, []);

  const endDrag = useCallback(() => {
    sourceRef.current = null;
    setDraggingPath(null);
    setDropOverPath(null);
    clearExpandTimer();
    window.setTimeout(() => {
      didDragRef.current = false;
    }, 0);
  }, [clearExpandTimer]);

  const hover = useCallback(
    (node: FileTreeNode, event: DragEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      const source = readDragPayload(event, sourceRef.current);
      if (!source) return;
      const dest = destinationForHover(source, node);
      if (!dest) {
        if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
        setDropOverPath((prev) => (prev === null ? prev : null));
        clearExpandTimer();
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      setDropOverPath((prev) => (prev === node.path ? prev : node.path));
      if (
        node.type === "dir" &&
        !node.isRoot &&
        !optsRef.current.isFolderExpanded(node.path)
      ) {
        clearExpandTimer();
        expandTimerRef.current = window.setTimeout(() => {
          optsRef.current.onExpandFolder(node.path);
        }, EXPAND_HOVER_MS);
      } else {
        clearExpandTimer();
      }
    },
    [clearExpandTimer],
  );

  const bindRow = useCallback(
    (node: FileTreeNode): BindProps => {
      const extra = [
        draggingPath === node.path ? "file-tree__row--dragging" : "",
        dropOverPath === node.path ? "file-tree__row--drop-target" : "",
      ]
        .filter(Boolean)
        .join(" ");
      return {
        draggable: !node.isRoot,
        className: extra,
        onDragStart: (event) => {
          if (node.isRoot) {
            event.preventDefault();
            return;
          }
          const payload = payloadFromNode(node);
          sourceRef.current = payload;
          didDragRef.current = true;
          try {
            event.dataTransfer?.setData(
              FILE_TREE_DRAG_MIME,
              JSON.stringify(payload),
            );
            event.dataTransfer?.setData("text/plain", node.path);
          } catch {
            // jsdom / some browsers reject custom MIME types
          }
          if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
          setDraggingPath(node.path);
        },
        onDragEnter: (event) => hover(node, event),
        onDragOver: (event) => hover(node, event),
        onDragLeave: (event) => {
          const related = event.relatedTarget as Node | null;
          if (related && event.currentTarget.contains(related)) return;
          setDropOverPath((prev) => (prev === node.path ? null : prev));
        },
        onDrop: (event) => {
          event.stopPropagation();
          event.preventDefault();
          const source = readDragPayload(event, sourceRef.current);
          const dest = source ? destinationForHover(source, node) : null;
          endDrag();
          if (!source || !dest) return;
          void optsRef.current.onMove(
            { path: source.path, name: source.name, type: source.type },
            dest,
          );
        },
        onDragEnd: () => {
          endDrag();
        },
        onClickCapture: (event) => {
          if (!didDragRef.current) return;
          event.preventDefault();
          event.stopPropagation();
          didDragRef.current = false;
        },
      };
    },
    [draggingPath, dropOverPath, endDrag, hover],
  );

  return { bindRow, draggingPath, dropOverPath };
}
