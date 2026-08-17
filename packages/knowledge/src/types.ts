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

export type KnowledgeService = {
  ingest(input: KnowledgeIngestInput): KnowledgeRecord;
  search(q: string): KnowledgeHit[];
  list(): KnowledgeRecord[];
  close(): void;
};
