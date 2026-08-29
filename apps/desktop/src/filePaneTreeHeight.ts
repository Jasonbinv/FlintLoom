export const FILE_TREE_MIN_HEIGHT = 120;
export const FILE_TREE_DEFAULT_HEIGHT = 240;
export const FILE_PREVIEW_MIN_HEIGHT = 160;
export const FILE_INNER_SPLIT_HANDLE_HEIGHT = 8;

const STORAGE_KEY = "flintloom.filePaneTreeHeight";

export function loadFilePaneTreeHeight(): number {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    const parsed = Number(stored);
    if (Number.isFinite(parsed) && parsed >= FILE_TREE_MIN_HEIGHT) {
      return parsed;
    }
  }
  return FILE_TREE_DEFAULT_HEIGHT;
}

export function saveFilePaneTreeHeight(height: number): void {
  localStorage.setItem(STORAGE_KEY, String(height));
}

export function clampFilePaneTreeHeight(
  height: number,
  bodyHeight: number,
): number {
  const max = Math.max(
    FILE_TREE_MIN_HEIGHT,
    bodyHeight - FILE_PREVIEW_MIN_HEIGHT - FILE_INNER_SPLIT_HANDLE_HEIGHT,
  );
  return Math.max(FILE_TREE_MIN_HEIGHT, Math.min(height, max));
}
