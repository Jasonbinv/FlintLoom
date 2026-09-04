export type RecentWorkspace = {
  path: string;
  updatedAt: number;
};

const STORAGE_KEY = "flintloom.workspace.recent";
const MAX_RECENT = 8;

export function loadRecentWorkspaces(): RecentWorkspace[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is RecentWorkspace =>
        item !== null &&
        typeof item === "object" &&
        typeof (item as RecentWorkspace).path === "string" &&
        typeof (item as RecentWorkspace).updatedAt === "number",
    );
  } catch {
    return [];
  }
}

export function addRecentWorkspace(
  path: string,
  existing?: RecentWorkspace[],
): RecentWorkspace[] {
  const trimmed = path.trim();
  if (trimmed.length === 0) {
    return existing ?? loadRecentWorkspaces();
  }
  const prev = existing ?? loadRecentWorkspaces();
  const now = Date.now();
  const next = [
    { path: trimmed, updatedAt: now },
    ...prev.filter((item) => item.path !== trimmed),
  ].slice(0, MAX_RECENT);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}
