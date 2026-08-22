import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { escapeLike, ftsLiteral, makeSnippet } from "./snippet.ts";
import type {
  KnowledgeHit,
  KnowledgeIngestInput,
  KnowledgeRecord,
  KnowledgeSearchOptions,
  KnowledgeService,
  KnowledgeStatus,
  KnowledgeStoreOptions,
} from "./types.ts";
import { cosineSimilarity } from "./vector.ts";

type DocRow = {
  id: number;
  workspace_root: string;
  rel_path: string;
  title: string;
  status: string;
  fail_reason: string | null;
  ingested_at: number;
};

type SearchRow = {
  id: number;
  workspace_root: string;
  rel_path: string;
  title: string;
  body: string;
  embedding_json: string | null;
};

function mapRow(row: DocRow): KnowledgeRecord {
  const record: KnowledgeRecord = {
    id: row.id,
    path: row.rel_path,
    title: row.title,
    status: row.status as KnowledgeStatus,
    ingestedAt: row.ingested_at,
    workspaceRoot: row.workspace_root,
  };
  if (row.fail_reason) {
    record.failReason = row.fail_reason;
  }
  return record;
}

function parseEmbedding(raw: string | null): number[] | undefined {
  if (raw === null || raw.length === 0) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return undefined;
    }
    const nums = parsed.filter((n) => typeof n === "number") as number[];
    return nums.length > 0 ? nums : undefined;
  } catch {
    return undefined;
  }
}

export function openKnowledge(
  dbPath: string,
  storeOpts: KnowledgeStoreOptions = {},
): KnowledgeService {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);

  db.exec(`
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY,
  workspace_root TEXT NOT NULL,
  rel_path TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  fail_reason TEXT,
  ingested_at INTEGER NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  embedding_json TEXT,
  UNIQUE(workspace_root, rel_path)
);
`);

  try {
    db.exec(`ALTER TABLE documents ADD COLUMN embedding_json TEXT`);
  } catch {
    /* column exists */
  }

  let fts = false;
  try {
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
  title,
  body,
  content='documents',
  content_rowid='id',
  tokenize='trigram'
)`);
    fts = true;
  } catch {
    /* LIKE fallback */
  }

  const ingestStmt = db.prepare(`
INSERT INTO documents (workspace_root, rel_path, title, status, fail_reason, ingested_at, body, embedding_json)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(workspace_root, rel_path) DO UPDATE SET
  title = excluded.title,
  status = excluded.status,
  fail_reason = excluded.fail_reason,
  ingested_at = excluded.ingested_at,
  body = excluded.body,
  embedding_json = excluded.embedding_json
RETURNING id, workspace_root, rel_path, title, status, fail_reason, ingested_at
`);

  const listStmt = db.prepare(`
SELECT id, workspace_root, rel_path, title, status, fail_reason, ingested_at
FROM documents
ORDER BY ingested_at DESC
LIMIT 200
`);

  const ftsDeleteStmt = fts
    ? db.prepare(`INSERT INTO documents_fts(documents_fts, rowid) VALUES('delete', ?)`)
    : null;
  const ftsInsertStmt = fts
    ? db.prepare(`INSERT INTO documents_fts(rowid, title, body) VALUES(?, ?, ?)`)
    : null;

  const ftsSearchStmt = fts
    ? db.prepare(`
SELECT d.id, d.workspace_root, d.rel_path, d.title, d.body, d.embedding_json
FROM documents_fts f
JOIN documents d ON d.id = f.rowid
WHERE documents_fts MATCH ? AND d.status = 'ok'
ORDER BY rank
LIMIT 8
`)
    : null;

  const likeSearchStmt = db.prepare(`
SELECT id, workspace_root, rel_path, title, body, embedding_json
FROM documents
WHERE status = 'ok' AND (title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')
ORDER BY ingested_at DESC
LIMIT 8
`);

  const vectorSearchStmt = db.prepare(`
SELECT id, workspace_root, rel_path, title, body, embedding_json
FROM documents
WHERE status = 'ok' AND embedding_json IS NOT NULL AND embedding_json != ''
`);

  function syncFts(id: number, title: string, body: string, status: KnowledgeStatus): void {
    if (!fts || !ftsDeleteStmt || !ftsInsertStmt) return;
    try {
      ftsDeleteStmt.run(id);
    } catch {
      /* ignore missing FTS row */
    }
    if (status === "ok") {
      ftsInsertStmt.run(id, title, body);
    }
  }

  function rowsToHits(rows: SearchRow[], q: string): KnowledgeHit[] {
    return rows.map((row) => ({
      id: row.id,
      path: row.rel_path,
      title: row.title,
      snippet: makeSnippet(row.body, q),
      workspaceRoot: row.workspace_root,
    }));
  }

  return {
    async ingest(input: KnowledgeIngestInput): Promise<KnowledgeRecord> {
      const ingestedAt = Date.now();
      const failReason = input.failReason ?? null;
      let embeddingJson: string | null = null;
      if (input.status === "ok" && storeOpts.embedText !== undefined) {
        const signal = new AbortController().signal;
        const vec = await storeOpts.embedText(
          `${input.title}\n${input.body.slice(0, 4000)}`,
          signal,
        );
        if (vec !== undefined) {
          embeddingJson = JSON.stringify(vec);
        }
      }
      const row = ingestStmt.get(
        input.workspaceRoot,
        input.relPath,
        input.title,
        input.status,
        failReason,
        ingestedAt,
        input.body,
        embeddingJson,
      ) as DocRow;
      syncFts(row.id, input.title, input.body, input.status);
      return mapRow(row);
    },

    async search(q: string, opts: KnowledgeSearchOptions = {}): Promise<KnowledgeHit[]> {
      const signal = opts.signal ?? new AbortController().signal;

      if (opts.embedQuery !== undefined) {
        const queryVec = await opts.embedQuery(q, signal);
        if (queryVec !== undefined) {
          const rows = vectorSearchStmt.all() as SearchRow[];
          const scored = rows
            .map((row) => {
              const embedding = parseEmbedding(row.embedding_json);
              if (embedding === undefined) {
                return undefined;
              }
              return {
                row,
                score: cosineSimilarity(queryVec, embedding),
              };
            })
            .filter((item) => item !== undefined)
            .sort((a, b) => b!.score - a!.score)
            .slice(0, 20)
            .map((item) => item!.row);
          if (scored.length > 0) {
            let hits = rowsToHits(scored.slice(0, 8), q);
            if (opts.rerank !== undefined && hits.length > 1) {
              const docs = hits.map((hit) => `${hit.title}\n${hit.snippet}`);
              const scores = await opts.rerank(q, docs, signal);
              if (scores !== undefined && scores.length === hits.length) {
                hits = hits
                  .map((hit, index) => ({ hit, score: scores[index] ?? 0 }))
                  .sort((a, b) => b.score - a.score)
                  .map((item) => item.hit);
              }
            }
            return hits;
          }
        }
      }

      const likeSearch = (): SearchRow[] => {
        const pattern = `%${escapeLike(q)}%`;
        return likeSearchStmt.all(pattern, pattern) as SearchRow[];
      };

      let rows: SearchRow[];
      if (fts && ftsSearchStmt && [...q].length >= 3) {
        rows = ftsSearchStmt.all(ftsLiteral(q)) as SearchRow[];
        if (rows.length === 0) {
          rows = likeSearch();
        }
      } else {
        rows = likeSearch();
      }
      let hits = rowsToHits(rows, q);
      if (opts.rerank !== undefined && hits.length > 1) {
        const docs = hits.map((hit) => `${hit.title}\n${hit.snippet}`);
        const scores = await opts.rerank(q, docs, signal);
        if (scores !== undefined && scores.length === hits.length) {
          hits = hits
            .map((hit, index) => ({ hit, score: scores[index] ?? 0 }))
            .sort((a, b) => b.score - a.score)
            .map((item) => item.hit);
        }
      }
      return hits;
    },

    list(): KnowledgeRecord[] {
      return (listStmt.all() as DocRow[]).map(mapRow);
    },

    close(): void {
      db.close();
    },
  };
}

export type { KnowledgeService } from "./types.ts";
