/** @vitest-environment jsdom */

import { describe, expect, it, beforeEach } from "vitest";
import {
  clampFilePaneTreeHeight,
  FILE_INNER_SPLIT_HANDLE_HEIGHT,
  FILE_PREVIEW_MIN_HEIGHT,
  FILE_TREE_DEFAULT_HEIGHT,
  FILE_TREE_MIN_HEIGHT,
  loadFilePaneTreeHeight,
  saveFilePaneTreeHeight,
} from "../src/filePaneTreeHeight.ts";

describe("filePaneTreeHeight", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("loads default height when unset", () => {
    expect(loadFilePaneTreeHeight()).toBe(FILE_TREE_DEFAULT_HEIGHT);
  });

  it("persists height in localStorage", () => {
    saveFilePaneTreeHeight(280);
    expect(loadFilePaneTreeHeight()).toBe(280);
  });

  it("clamps height between min and body-derived max", () => {
    const bodyHeight = 600;
    const max =
      bodyHeight - FILE_PREVIEW_MIN_HEIGHT - FILE_INNER_SPLIT_HANDLE_HEIGHT;
    expect(clampFilePaneTreeHeight(40, bodyHeight)).toBe(FILE_TREE_MIN_HEIGHT);
    expect(clampFilePaneTreeHeight(9999, bodyHeight)).toBe(max);
    expect(clampFilePaneTreeHeight(260, bodyHeight)).toBe(260);
  });
});
