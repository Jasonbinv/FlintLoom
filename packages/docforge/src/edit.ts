import { readFile, stat, writeFile } from "node:fs/promises";
import { detectType } from "./detect.ts";
import {
  GENERATE_MAX_BYTES,
  GENERATE_MAX_CHARS,
  copyMarkdown,
} from "./generate.ts";

export function normalizeMarkdown(raw: string): string {
  const body = raw.startsWith("\uFEFF") ? raw.slice(1) : raw;
  return body.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

export function countNonOverlap(haystack: string, needle: string): number {
  if (needle.length === 0) {
    return 0;
  }
  let n = 0;
  let i = 0;
  while (true) {
    const found = haystack.indexOf(needle, i);
    if (found === -1) {
      return n;
    }
    n += 1;
    i = found + needle.length;
  }
}

function ioCode(err: unknown): string {
  return typeof err === "object" && err !== null && "code" in err
    ? (err as { code: string }).code
    : "";
}

export async function editMarkdown(
  absPath: string,
  old: string,
  replacement: string,
): Promise<{ replaced: 1 }> {
  if (old.length === 0) {
    throw new Error("missing old");
  }
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
  const bytes = await readFile(absPath);
  if (detectType(absPath, bytes) !== "md") {
    throw new Error("bad source");
  }
  const body = normalizeMarkdown(bytes.toString("utf8"));
  if (body.length > GENERATE_MAX_CHARS) {
    throw new Error("too large");
  }
  const hits = countNonOverlap(body, old);
  if (hits === 0) {
    throw new Error("not found");
  }
  if (hits >= 2) {
    throw new Error("not unique");
  }
  const at = body.indexOf(old);
  const next = `${body.slice(0, at)}${replacement}${body.slice(at + old.length)}`;
  const out = copyMarkdown(next);
  if (out.length > GENERATE_MAX_CHARS) {
    throw new Error("too large");
  }
  await writeFile(absPath, out, "utf8");
  return { replaced: 1 };
}
