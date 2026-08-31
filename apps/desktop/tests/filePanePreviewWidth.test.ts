/** @vitest-environment jsdom */

import { describe, expect, it, beforeEach } from "vitest";
import {
  availableFilePreviewWidth,
  clampFilePreviewWidth,
  FILE_INNER_SPLIT_HANDLE_WIDTH,
  FILE_PREVIEW_DEFAULT_WIDTH,
  FILE_PREVIEW_MIN_WIDTH,
  filePreviewExtraWidth,
  loadFilePreviewWidth,
  saveFilePreviewWidth,
} from "../src/filePanePreviewWidth.ts";
import {
  CHAT_COLUMN_MIN_WIDTH,
  FILE_PANE_HANDLE_WIDTH,
  FILE_PANE_MIN_WIDTH,
} from "../src/filePaneWidth.ts";

describe("filePanePreviewWidth", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("loads default width when unset", () => {
    expect(loadFilePreviewWidth()).toBe(FILE_PREVIEW_DEFAULT_WIDTH);
  });

  it("persists width in localStorage", () => {
    saveFilePreviewWidth(640);
    expect(loadFilePreviewWidth()).toBe(640);
  });

  it("clamps to remaining stage after chat and tree", () => {
    const stageWidth = 1600;
    const treeWidth = 300;
    const available = availableFilePreviewWidth(stageWidth, treeWidth);
    expect(available).toBe(
      stageWidth -
        CHAT_COLUMN_MIN_WIDTH -
        FILE_PANE_HANDLE_WIDTH -
        treeWidth -
        FILE_INNER_SPLIT_HANDLE_WIDTH,
    );
    expect(clampFilePreviewWidth(100, stageWidth, treeWidth)).toBe(
      FILE_PREVIEW_MIN_WIDTH,
    );
    expect(clampFilePreviewWidth(9999, stageWidth, treeWidth)).toBe(available);
    expect(clampFilePreviewWidth(520, stageWidth, treeWidth)).toBe(520);
  });

  it("shrinks below the preferred min when the stage is narrow", () => {
    const stageWidth = 900;
    const treeWidth = FILE_PANE_MIN_WIDTH;
    const available = availableFilePreviewWidth(stageWidth, treeWidth);
    expect(available).toBeLessThan(FILE_PREVIEW_MIN_WIDTH);
    expect(clampFilePreviewWidth(FILE_PREVIEW_DEFAULT_WIDTH, stageWidth, treeWidth)).toBe(
      available,
    );
  });

  it("reports extra rail width only while preview is open", () => {
    expect(filePreviewExtraWidth(false, 560)).toBe(0);
    expect(filePreviewExtraWidth(true, 560)).toBe(
      FILE_INNER_SPLIT_HANDLE_WIDTH + 560,
    );
  });
});
