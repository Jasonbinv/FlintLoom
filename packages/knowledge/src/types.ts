export type KnowledgeStatus = "ok" | "failed";

export type KnowledgeRecord = {
  id: number;
  path: string;
  title: string;
  status: KnowledgeStatus;
  ingestedAt: number;
  workspaceRoot: string;
  failReason?: string;
};

export type KnowledgeHit = {
  id: number;
  path: string;
  title: string;
  snippet: string;
  workspaceRoot: string;
};

export type KnowledgeIngestInput = {
  workspaceRoot: string;
  relPath: string;
  title: string;
  status: KnowledgeStatus;
  body: string;
  failReason?: string;
};

export type KnowledgeSearchOptions = {
  signal?: AbortSignal;
  embedQuery?: (text: string, signal: AbortSignal) => Promise<number[] | undefined>;
  rerank?: (
    query: string,
    documents: string[],
    signal: AbortSignal,
  ) => Promise<number[] | undefined>;
};

export type KnowledgeService = {
  ingest(input: KnowledgeIngestInput): Promise<KnowledgeRecord>;
  search(q: string, opts?: KnowledgeSearchOptions): Promise<KnowledgeHit[]>;
  list(): KnowledgeRecord[];
  close(): void;
};

export type KnowledgeStoreOptions = {
  embedText?: (text: string, signal: AbortSignal) => Promise<number[] | undefined>;
};
