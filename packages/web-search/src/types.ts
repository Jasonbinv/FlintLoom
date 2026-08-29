export type SearchProviderId = "searxng" | "tavily" | "brave" | "bocha";

export type SearchConfig = {
  provider?: SearchProviderId;
  searxngUrl?: string;
  tavilyApiKey?: string;
  braveApiKey?: string;
  bochaApiKey?: string;
  fetch?: typeof fetch;
};

export type SearchHit = { title: string; url: string; snippet: string };

export type SearchOutcome =
  | { ok: true; hits: SearchHit[] }
  | { ok: false; error: string };

export type SearchArgs = { query: string; count: number };
