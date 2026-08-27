import { existsSync } from "node:fs";
import type { SessionEvent } from "./events.ts";
import {
  appendSessionEvent,
  loadSessionEvents,
  sessionFilePath,
} from "./persist.ts";
import { Session } from "./session.ts";

export type SessionStoreOptions = {
  sessionsDir?: string;
};

export class SessionStore {
  readonly #map = new Map<string, Session>();
  readonly #sessionsDir?: string;

  constructor(opts?: SessionStoreOptions) {
    this.#sessionsDir = opts?.sessionsDir;
  }

  get(id: string): Session | undefined {
    this.#ensureLoaded(id);
    return this.#map.get(id);
  }

  getOrCreate(id: string): Session {
    this.#ensureLoaded(id);
    const existing = this.#map.get(id);
    if (existing !== undefined) {
      return existing;
    }
    const created = this.#createSession(id, []);
    this.#map.set(id, created);
    return created;
  }

  #ensureLoaded(id: string): void {
    if (this.#map.has(id) || this.#sessionsDir === undefined) {
      return;
    }
    const filePath = sessionFilePath(this.#sessionsDir, id);
    if (!existsSync(filePath)) {
      return;
    }
    const events = loadSessionEvents(filePath);
    if (events.length === 0) {
      return;
    }
    this.#map.set(id, this.#createSession(id, events));
  }

  #createSession(id: string, preload: readonly SessionEvent[]): Session {
    if (this.#sessionsDir === undefined) {
      return new Session(id, { preload });
    }
    const filePath = sessionFilePath(this.#sessionsDir, id);
    return new Session(id, {
      preload,
      persist: (event) => {
        appendSessionEvent(filePath, event);
      },
    });
  }
}
