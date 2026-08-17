export type KnowledgeListItem = {
  id: number;
  path: string;
  title: string;
  status: "ok" | "failed";
  ingestedAt: number;
  current: boolean;
  failReason?: string;
};

export type KnowledgeHit = {
  id: number;
  path: string;
  title: string;
  snippet: string;
  current: boolean;
};

export async function fetchKnowledge(
  signal?: AbortSignal,
): Promise<{ items: KnowledgeListItem[] }> {
  const res = await fetch("/v1/knowledge", { signal });
  if (!res.ok) throw new Error("host unreachable");
  return (await res.json()) as { items: KnowledgeListItem[] };
}

export async function searchKnowledge(
  q: string,
  signal?: AbortSignal,
): Promise<{ hits: KnowledgeHit[] }> {
  const res = await fetch(`/v1/knowledge/search?q=${encodeURIComponent(q)}`, {
    signal,
  });
  if (!res.ok) throw new Error("host unreachable");
  return (await res.json()) as { hits: KnowledgeHit[] };
}

export async function importKnowledge(path: string): Promise<unknown> {
  const res = await fetch("/v1/knowledge/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) throw new Error("host unreachable");
  return await res.json();
}
