export const FILE_PANE_MIN_WIDTH = 240;
export const FILE_PANE_DEFAULT_WIDTH = 480;
export const FILE_PANE_COLLAPSED_WIDTH = 40;
export const FILE_PANE_HANDLE_WIDTH = 8;
export const CHAT_COLUMN_MIN_WIDTH = 360;

const STORAGE_KEY = "flintloom.filePaneWidth";

export function loadFilePaneWidth(): number {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    const parsed = Number(stored);
    if (Number.isFinite(parsed) && parsed >= FILE_PANE_MIN_WIDTH) {
      return parsed;
    }
  }
  return FILE_PANE_DEFAULT_WIDTH;
}

export function saveFilePaneWidth(width: number): void {
  localStorage.setItem(STORAGE_KEY, String(width));
}

export function clampFilePaneWidth(width: number, stageWidth: number): number {
  const max = Math.max(
    FILE_PANE_MIN_WIDTH,
    stageWidth - CHAT_COLUMN_MIN_WIDTH - FILE_PANE_HANDLE_WIDTH,
  );
  return Math.max(FILE_PANE_MIN_WIDTH, Math.min(width, max));
}
