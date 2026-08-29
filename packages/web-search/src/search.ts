import type {
  SearchArgs,
  SearchConfig,
  SearchHit,
  SearchOutcome,
  SearchProviderId,
} from "./types.ts";

export type { SearchArgs, SearchConfig, SearchHit, SearchOutcome, SearchProviderId } from "./types.ts";

const SEARCH_TIMEOUT_MS = 12_000;

function hasCjk(q: string): boolean {
  return /[\u3400-\u9fff]/.test(q);
}

function stripSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function truncateSnippet(text: string): string {
  return text.length > 240 ? text.slice(0, 240) : text;
}

function hasCredential(config: SearchConfig, provider: SearchProviderId): boolean {
  switch (provider) {
    case "searxng":
      return Boolean(config.searxngUrl);
    case "tavily":
      return Boolean(config.tavilyApiKey);
    case "brave":
      return Boolean(config.braveApiKey);
    case "bocha":
      return Boolean(config.bochaApiKey);
  }
}

export function resolveSearchProvider(config: SearchConfig): SearchProviderId | undefined {
  if (config.provider) {
    return hasCredential(config, config.provider) ? config.provider : undefined;
  }

  const order: SearchProviderId[] = ["searxng", "tavily", "brave", "bocha"];
  return order.find((id) => hasCredential(config, id));
}

function mapHits(
  raw: Array<{ title?: string; url?: string; snippet?: string; content?: string; description?: string; name?: string }>,
  count: number,
  snippetField: "snippet" | "content" | "description" | "name" = "snippet",
): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const item of raw) {
    const title = item.title ?? item.name;
    const url = item.url;
    if (!title || !url) {
      continue;
    }
    const rawSnippet =
      snippetField === "content"
        ? item.content
        : snippetField === "description"
          ? item.description
          : item.snippet ?? item.content ?? item.description ?? "";
    hits.push({
      title,
      url,
      snippet: truncateSnippet(String(rawSnippet ?? "")),
    });
    if (hits.length >= count) {
      break;
    }
  }
  return hits;
}

async function searchSearxng(
  config: SearchConfig,
  args: SearchArgs,
  fetchFn: typeof fetch,
  signal: AbortSignal,
): Promise<SearchOutcome> {
  const base = stripSlash(config.searxngUrl!);
  const params = new URLSearchParams({ q: args.query, format: "json" });
  if (hasCjk(args.query)) {
    params.set("language", "zh-CN");
  }
  const res = await fetchFn(`${base}/search?${params}`, { signal });
  if (!res.ok) {
    return { ok: false, error: `failed: search ${res.status}` };
  }
  const data = (await res.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
  const results = Array.isArray(data.results) ? data.results : [];
  return { ok: true, hits: mapHits(results, args.count, "content") };
}

async function searchTavily(
  config: SearchConfig,
  args: SearchArgs,
  fetchFn: typeof fetch,
  signal: AbortSignal,
): Promise<SearchOutcome> {
  const res = await fetchFn("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: config.tavilyApiKey,
      query: args.query,
      max_results: args.count,
      search_depth: "basic",
    }),
    signal,
  });
  if (!res.ok) {
    return { ok: false, error: `failed: search ${res.status}` };
  }
  const data = (await res.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
  const results = Array.isArray(data.results) ? data.results : [];
  return { ok: true, hits: mapHits(results, args.count, "content") };
}

async function searchBrave(
  config: SearchConfig,
  args: SearchArgs,
  fetchFn: typeof fetch,
  signal: AbortSignal,
): Promise<SearchOutcome> {
  const params = new URLSearchParams({ q: args.query, count: String(args.count) });
  const res = await fetchFn(`https://api.search.brave.com/res/v1/web/search?${params}`, {
    headers: { "X-Subscription-Token": config.braveApiKey! },
    signal,
  });
  if (!res.ok) {
    return { ok: false, error: `failed: search ${res.status}` };
  }
  const data = (await res.json()) as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
  };
  const results = Array.isArray(data.web?.results) ? data.web.results : [];
  return { ok: true, hits: mapHits(results, args.count, "description") };
}

async function searchBocha(
  config: SearchConfig,
  args: SearchArgs,
  fetchFn: typeof fetch,
  signal: AbortSignal,
): Promise<SearchOutcome> {
  const res = await fetchFn("https://api.bochaai.com/v1/web-search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.bochaApiKey}`,
    },
    body: JSON.stringify({ query: args.query, count: args.count, summary: true }),
    signal,
  });
  if (!res.ok) {
    return { ok: false, error: `failed: search ${res.status}` };
  }
  const data = (await res.json()) as {
    data?: { webPages?: { value?: Array<{ name?: string; url?: string; snippet?: string }> } };
  };
  const results = Array.isArray(data.data?.webPages?.value) ? data.data.webPages.value : [];
  return { ok: true, hits: mapHits(results, args.count, "snippet") };
}

export async function searchWeb(
  config: SearchConfig,
  args: SearchArgs,
  signal: AbortSignal,
): Promise<SearchOutcome> {
  const provider = resolveSearchProvider(config);
  if (!provider) {
    return { ok: false, error: "failed: search not configured" };
  }

  const fetchFn = config.fetch ?? fetch;
  const combined = AbortSignal.any([signal, AbortSignal.timeout(SEARCH_TIMEOUT_MS)]);

  try {
    switch (provider) {
      case "searxng":
        return await searchSearxng(config, args, fetchFn, combined);
      case "tavily":
        return await searchTavily(config, args, fetchFn, combined);
      case "brave":
        return await searchBrave(config, args, fetchFn, combined);
      case "bocha":
        return await searchBocha(config, args, fetchFn, combined);
    }
  } catch (err) {
    if (signal.aborted) {
      return { ok: false, error: "aborted" };
    }
    if (err instanceof DOMException && err.name === "TimeoutError") {
      return { ok: false, error: "failed: timeout" };
    }
    if (combined.aborted && !signal.aborted) {
      return { ok: false, error: "failed: timeout" };
    }
    return { ok: false, error: "failed: search" };
  }
}
