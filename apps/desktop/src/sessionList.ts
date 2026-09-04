export type SessionEntry = {
  id: string;
  title: string;
  updatedAt: number;
};

const STORAGE_KEY = "flintloom.sessions";

export function loadSessions(): SessionEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SessionEntry =>
        item !== null &&
        typeof item === "object" &&
        typeof (item as SessionEntry).id === "string" &&
        typeof (item as SessionEntry).title === "string" &&
        typeof (item as SessionEntry).updatedAt === "number",
    );
  } catch {
    return [];
  }
}

export function saveSessions(sessions: SessionEntry[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

export function upsertSession(
  sessions: SessionEntry[],
  id: string,
  title: string,
): SessionEntry[] {
  const trimmed = title.trim();
  const label =
    trimmed.length > 48 ? `${trimmed.slice(0, 48)}…` : trimmed || "新对话";
  const now = Date.now();
  const existing = sessions.find((s) => s.id === id);
  if (existing) {
    return saveAndSort(
      sessions.map((s) =>
        s.id === id ? { ...s, title: label, updatedAt: now } : s,
      ),
    );
  }
  return saveAndSort([{ id, title: label, updatedAt: now }, ...sessions]);
}

export function removeSession(
  sessions: SessionEntry[],
  id: string,
): SessionEntry[] {
  return saveAndSort(sessions.filter((s) => s.id !== id));
}

function saveAndSort(sessions: SessionEntry[]): SessionEntry[] {
  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  saveSessions(sorted);
  return sorted;
}

export function titleFromBubbles(
  bubbles: { kind: string; text?: string }[],
): string {
  const user = bubbles.find(
    (b) => b.kind === "user" && typeof b.text === "string" && b.text.trim().length > 0,
  );
  return user?.text?.trim() ?? "新对话";
}
