/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it } from "vitest";
import {
  loadSessions,
  removeSession,
  saveSessions,
  titleFromBubbles,
  upsertSession,
} from "../src/sessionList.ts";

beforeEach(() => {
  localStorage.clear();
});

describe("sessionList", () => {
  it("loads and saves sessions", () => {
    saveSessions([{ id: "a", title: "One", updatedAt: 100 }]);
    expect(loadSessions()).toEqual([{ id: "a", title: "One", updatedAt: 100 }]);
  });

  it("upserts existing session title", () => {
    const first = upsertSession([], "a", "Alpha");
    const second = upsertSession(first, "b", "Beta");
    const updated = upsertSession(second, "a", "Alpha updated");
    expect(updated).toHaveLength(2);
    expect(updated.find((s) => s.id === "a")?.title).toBe("Alpha updated");
    expect(updated.find((s) => s.id === "b")?.title).toBe("Beta");
  });

  it("truncates long titles", () => {
    const long = "x".repeat(60);
    const sessions = upsertSession([], "id", long);
    expect(sessions[0]?.title.endsWith("…")).toBe(true);
    expect(sessions[0]?.title.length).toBe(49);
  });

  it("removes session from list", () => {
    const first = upsertSession([], "a", "Alpha");
    const second = upsertSession(first, "b", "Beta");
    const remaining = removeSession(second, "b");
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe("a");
  });

  it("derives title from first user bubble", () => {
    expect(
      titleFromBubbles([
        { kind: "assistant", text: "hi" },
        { kind: "user", text: "  my task  " },
      ]),
    ).toBe("my task");
  });
});
