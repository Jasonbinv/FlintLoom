import { Session } from "./session.ts";

export class SessionStore {
  readonly #map = new Map<string, Session>();

  get(id: string): Session | undefined {
    return this.#map.get(id);
  }

  getOrCreate(id: string): Session {
    const existing = this.#map.get(id);
    if (existing !== undefined) {
      return existing;
    }
    const created = new Session(id);
    this.#map.set(id, created);
    return created;
  }
}
