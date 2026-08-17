import { realpathSync } from "node:fs";
import { basename, relative } from "node:path";
import { stat } from "node:fs/promises";
import type { KnowledgeRecord, KnowledgeService } from "@flintloom/knowledge";
import { isHiddenRelPath, resolveInside } from "@flintloom/tools";
import { parse } from "./parse.ts";

export type IngestOutcome =
  | { kind: "aborted" }
  | { kind: "missing_path" }
  | { kind: "hidden"; path: string }
  | { kind: "not_found" }
  | { kind: "not_a_file" }
  | { kind: "written"; record: KnowledgeRecord };

function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "ENOENT"
  );
}

function titleFromBody(body: string, relPath: string): string {
  const match = body.match(/^#\s+(.+)$/m);
  if (match?.[1] !== undefined) {
    return match[1].trim();
  }
  return basename(relPath);
}

export async function ingestWorkspaceFile(
  kb: KnowledgeService,
  workspaceRoot: string,
  inputPath: string | undefined,
  signal?: AbortSignal,
): Promise<IngestOutcome> {
  if (signal?.aborted) {
    return { kind: "aborted" };
  }
  if (inputPath === undefined || inputPath.length === 0) {
    return { kind: "missing_path" };
  }

  const absPath = resolveInside(workspaceRoot, inputPath);
  const realRoot = realpathSync.native(workspaceRoot);
  const relPath = relative(realRoot, absPath).replaceAll("\\", "/");

  if (isHiddenRelPath(inputPath) || isHiddenRelPath(relPath)) {
    return { kind: "hidden", path: inputPath };
  }

  let st;
  try {
    st = await stat(absPath);
  } catch (err) {
    if (isNotFound(err)) {
      return { kind: "not_found" };
    }
    throw err;
  }

  if (!st.isFile()) {
    return { kind: "not_a_file" };
  }

  const parsed = await parse(absPath);
  if (parsed.startsWith("failed:")) {
    const failReason = parsed.slice("failed: ".length);
    const record = kb.ingest({
      workspaceRoot: realRoot,
      relPath,
      title: basename(relPath),
      status: "failed",
      body: "",
      failReason,
    });
    return { kind: "written", record };
  }

  const record = kb.ingest({
    workspaceRoot: realRoot,
    relPath,
    title: titleFromBody(parsed, relPath),
    status: "ok",
    body: parsed,
  });
  return { kind: "written", record };
}
