import {
  CHAT_COLUMN_MIN_WIDTH,
  FILE_PANE_HANDLE_WIDTH,
  FILE_PANE_MIN_WIDTH,
} from "./filePaneWidth.ts";

export const FILE_PREVIEW_MIN_WIDTH = 380;
export const FILE_PREVIEW_DEFAULT_WIDTH = 560;
export const FILE_INNER_SPLIT_HANDLE_WIDTH = 8;

const STORAGE_KEY = "flintloom.filePreviewWidth";

export function loadFilePreviewWidth(): number {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    const parsed = Number(stored);
    if (Number.isFinite(parsed) && parsed >= 200) {
      return parsed;
    }
  }
  return FILE_PREVIEW_DEFAULT_WIDTH;
}

export function saveFilePreviewWidth(width: number): void {
  localStorage.setItem(STORAGE_KEY, String(width));
}

/** Room left for a preview column after chat min-width and the file tree. */
export function availableFilePreviewWidth(
  stageWidth: number,
  treeWidth: number,
): number {
  return (
    stageWidth -
    CHAT_COLUMN_MIN_WIDTH -
    FILE_PANE_HANDLE_WIDTH -
    Math.max(FILE_PANE_MIN_WIDTH, treeWidth) -
    FILE_INNER_SPLIT_HANDLE_WIDTH
  );
}

export function clampFilePreviewWidth(
  width: number,
  stageWidth: number,
  treeWidth: number,
): number {
  const available = availableFilePreviewWidth(stageWidth, treeWidth);
  const hi = Math.max(200, available);
  const lo = Math.min(FILE_PREVIEW_MIN_WIDTH, hi);
  return Math.max(lo, Math.min(width, hi));
}

export function filePreviewExtraWidth(
  previewOpen: boolean,
  previewWidth: number,
): number {
  if (!previewOpen) return 0;
  return FILE_INNER_SPLIT_HANDLE_WIDTH + previewWidth;
}
