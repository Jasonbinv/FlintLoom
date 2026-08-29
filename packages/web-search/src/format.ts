import type { SearchHit } from "./types.ts";

export function formatSearchHits(hits: SearchHit[]): string {
  if (hits.length === 0) {
    return "No results.";
  }

  const parts: string[] = [];
  for (let i = 0; i < hits.length; i++) {
    const { title, url, snippet } = hits[i];
    parts.push(`${i + 1}. ${title}\n   ${url}\n   ${snippet}`);
  }

  const text = parts.join("\n\n");
  return text.length > 8000 ? text.slice(0, 8000) : text;
}
