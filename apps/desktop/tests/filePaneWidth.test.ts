/** @vitest-environment jsdom */

import { describe, expect, it, beforeEach } from "vitest";
import {
  clampFilePaneWidth,
  CHAT_COLUMN_MIN_WIDTH,
  FILE_PANE_DEFAULT_WIDTH,
  FILE_PANE_HANDLE_WIDTH,
  FILE_PANE_MIN_WIDTH,
  loadFilePaneWidth,
  saveFilePaneWidth,
} from "../src/filePaneWidth.ts";

describe("filePaneWidth", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("loads default width when unset", () => {
    expect(loadFilePaneWidth()).toBe(FILE_PANE_DEFAULT_WIDTH);
  });

  it("persists width in localStorage", () => {
    saveFilePaneWidth(420);
    expect(loadFilePaneWidth()).toBe(420);
  });

  it("clamps width between min and stage-derived max", () => {
    const stageWidth = 1200;
    const max =
      stageWidth - CHAT_COLUMN_MIN_WIDTH - FILE_PANE_HANDLE_WIDTH;
    expect(clampFilePaneWidth(100, stageWidth)).toBe(FILE_PANE_MIN_WIDTH);
    expect(clampFilePaneWidth(9999, stageWidth)).toBe(max);
    expect(clampFilePaneWidth(360, stageWidth)).toBe(360);
  });

  it("reserves the open preview column when clamping tree width", () => {
    const stageWidth = 1200;
    const reservedRight = 400;
    const max =
      stageWidth - CHAT_COLUMN_MIN_WIDTH - FILE_PANE_HANDLE_WIDTH - reservedRight;
    expect(clampFilePaneWidth(9999, stageWidth, reservedRight)).toBe(max);
  });
});
