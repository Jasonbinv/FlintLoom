import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SessionEvent } from "../src/events.ts";
import {
  appendSessionEvent,
  loadSessionEvents,
  sessionFilePath,
} from "../src/persist.ts";
import { SessionStore } from "../src/store.ts";

describe("session persistence", () => {
  it("writes append-only jsonl and reloads events", () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-session-persist-"));
    const store = new SessionStore({ sessionsDir: dir });
    const events: SessionEvent[] = [
      { type: "turn/start", turnId: "t1", startedAt: 1000 },
      { type: "user/message", text: "hello" },
      { type: "assistant/message", text: "hi there" },
      { type: "turn/end", turnId: "t1", status: "ok" },
    ];
    const session = store.getOrCreate("desktop:abc");
    for (const event of events) {
      session.append(event);
    }

    const filePath = sessionFilePath(dir, "desktop:abc");
    expect(readFileSync(filePath, "utf8").trim().split("\n")).toHaveLength(4);

    const reloaded = new SessionStore({ sessionsDir: dir });
    expect(reloaded.get("desktop:abc")?.events()).toEqual(events);
    expect(reloaded.getOrCreate("desktop:abc").events()).toEqual(events);
  });

  it("loadSessionEvents skips blank and invalid lines", () => {
    const dir = mkdtempSync(join(tmpdir(), "flintloom-session-persist-"));
    const filePath = sessionFilePath(dir, "s1");
    appendSessionEvent(filePath, { type: "user/message", text: "ok" });
    appendSessionEvent(filePath, { type: "user/message", text: "also ok" });
    const raw = readFileSync(filePath, "utf8");
    writeFileSync(filePath, `${raw}\n\n{broken\n`, "utf8");
    expect(loadSessionEvents(filePath)).toEqual([
      { type: "user/message", text: "ok" },
      { type: "user/message", text: "also ok" },
    ]);
  });
});
