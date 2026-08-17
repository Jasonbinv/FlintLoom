export function makeSnippet(body: string, q: string, limit = 240): string {
  const idx = body.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) {
    return body.length > limit ? `${body.slice(0, limit)}…` : body;
  }
  const half = Math.max(0, Math.floor((limit - q.length) / 2));
  let start = Math.max(0, idx - half);
  let end = Math.min(body.length, start + limit);
  if (end - start < limit) {
    start = Math.max(0, end - limit);
  }
  const prefix = start > 0 ? "…" : "";
  const suffix = end < body.length ? "…" : "";
  return `${prefix}${body.slice(start, end)}${suffix}`;
}

export function escapeLike(q: string): string {
  return q.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

export function ftsLiteral(q: string): string {
  return `"${q.replaceAll('"', '""')}"`;
}
