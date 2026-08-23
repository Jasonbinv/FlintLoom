/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it } from "vitest";
import { addRecentWorkspace, loadRecentWorkspaces } from "../src/workspaceRecent.ts";

beforeEach(() => {
  localStorage.clear();
});

describe("workspaceRecent", () => {
  it("loads and saves recent workspaces", () => {
    const first = addRecentWorkspace("C:/projects/alpha");
    expect(first).toEqual([
      { path: "C:/projects/alpha", updatedAt: expect.any(Number) },
    ]);
    expect(loadRecentWorkspaces()).toEqual(first);
  });

  it("moves existing path to front", () => {
    addRecentWorkspace("C:/projects/alpha");
    addRecentWorkspace("C:/projects/beta");
    const updated = addRecentWorkspace("C:/projects/alpha");
    expect(updated.map((item) => item.path)).toEqual([
      "C:/projects/alpha",
      "C:/projects/beta",
    ]);
  });

  it("caps list at eight entries", () => {
    let list = [] as ReturnType<typeof addRecentWorkspace>;
    for (let i = 0; i < 10; i += 1) {
      list = addRecentWorkspace(`C:/projects/ws-${i}`, list);
    }
    expect(list).toHaveLength(8);
    expect(list[0]?.path).toBe("C:/projects/ws-9");
    expect(list[7]?.path).toBe("C:/projects/ws-2");
  });
});
