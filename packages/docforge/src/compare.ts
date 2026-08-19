import { stat } from "node:fs/promises";
import { createTwoFilesPatch } from "diff";
import { normalizeMarkdown } from "./edit.ts";
import {
  GENERATE_MAX_BYTES,
  GENERATE_MAX_CHARS,
} from "./generate.ts";
import { parseToMarkdown } from "./parse.ts";

function ioCode(err: unknown): string {
  return typeof err === "object" && err !== null && "code" in err
    ? (err as { code: string }).code
    : "";
}

async function loadSide(absPath: string): Promise<string> {
  let st;
  try {
    st = await stat(absPath);
  } catch (err) {
    if (ioCode(err) === "ENOENT") {
      throw new Error("not found");
    }
    throw new Error("unreadable");
  }
  if (!st.isFile()) {
    throw new Error("unreadable");
  }
  if (st.size > GENERATE_MAX_BYTES) {
    throw new Error("too large");
  }
  const parsed = await parseToMarkdown(absPath);
  if (!parsed.ok) {
    throw new Error(parsed.reason);
  }
  const body = normalizeMarkdown(parsed.markdown);
  if (body.length > GENERATE_MAX_CHARS) {
    throw new Error("too large");
  }
  return body;
}

export async function compareDocuments(
  absA: string,
  absB: string,
  aRel: string,
  bRel: string,
): Promise<{ identical: boolean; diff: string }> {
  const aMd = await loadSide(absA);
  const bMd = await loadSide(absB);
  if (aMd === bMd) {
    return { identical: true, diff: "" };
  }
  const diffText = createTwoFilesPatch(
    aRel,
    bRel,
    aMd,
    bMd,
    undefined,
    undefined,
    { context: 3 },
  );
  if (diffText.length > GENERATE_MAX_CHARS) {
    throw new Error("too large");
  }
  return { identical: false, diff: diffText };
}
