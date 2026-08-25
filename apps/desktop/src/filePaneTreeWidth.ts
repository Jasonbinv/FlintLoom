export const FILE_TREE_MIN_WIDTH = 120;
export const FILE_TREE_DEFAULT_WIDTH = 200;
export const FILE_PREVIEW_MIN_WIDTH = 140;
export const FILE_INNER_SPLIT_HANDLE_WIDTH = 8;

const STORAGE_KEY = "flintloom.filePaneTreeWidth";

export function loadFilePaneTreeWidth(): number {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    const parsed = Number(stored);
    if (Number.isFinite(parsed) && parsed >= FILE_TREE_MIN_WIDTH) {
      return parsed;
    }
  }
  return FILE_TREE_DEFAULT_WIDTH;
}

export function saveFilePaneTreeWidth(width: number): void {
  localStorage.setItem(STORAGE_KEY, String(width));
}

export function clampFilePaneTreeWidth(width: number, bodyWidth: number): number {
  const max = Math.max(
    FILE_TREE_MIN_WIDTH,
    bodyWidth - FILE_PREVIEW_MIN_WIDTH - FILE_INNER_SPLIT_HANDLE_WIDTH,
  );
  return Math.max(FILE_TREE_MIN_WIDTH, Math.min(width, max));
}
