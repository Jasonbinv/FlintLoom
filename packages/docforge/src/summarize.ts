import { stat } from "node:fs/promises";
import { type ChatRequest, type ModelRegistry } from "@flintloom/models";
import { normalizeMarkdown } from "./edit.ts";
import { GENERATE_MAX_BYTES, GENERATE_MAX_CHARS } from "./generate.ts";
import { parseToMarkdown } from "./parse.ts";

export const SUMMARIZE_MAX_CHARS = 4000;

export const SUMMARIZE_SYSTEM =
  "Summarize the document in the user message. Write the summary only. Use the same language as the document. Do not call tools. Do not wrap the summary in markdown fences.";

export type SummarizeResult =
  | { ok: true; summary: string }
  | {
      ok: false;
      reason:
        | "aborted"
        | "not found"
        | "not a file"
        | "too large"
        | "unsupported type"
        | "encrypted"
        | "empty text"
        | "unreadable";
    };

function ioCode(err: unknown): string {
  return typeof err === "object" && err !== null && "code" in err
    ? (err as { code: string }).code
    : "";
}

export async function summarizeDocument(
  absPath: string,
  models: ModelRegistry,
  signal: AbortSignal,
): Promise<SummarizeResult> {
  if (signal.aborted) {
    return { ok: false, reason: "aborted" };
  }

  let st;
  try {
    st = await stat(absPath);
  } catch (err) {
    if (ioCode(err) === "ENOENT") {
      return { ok: false, reason: "not found" };
    }
    return { ok: false, reason: "unreadable" };
  }
  if (!st.isFile()) {
    return { ok: false, reason: "not a file" };
  }
  if (st.size > GENERATE_MAX_BYTES) {
    return { ok: false, reason: "too large" };
  }

  const parsed = await parseToMarkdown(absPath);
  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason };
  }
  if (parsed.markdown.replace(/\s+/g, " ").trim().length === 0) {
    return { ok: false, reason: "empty text" };
  }

  const markdown = normalizeMarkdown(parsed.markdown);
  if (markdown.length > GENERATE_MAX_CHARS) {
    return { ok: false, reason: "too large" };
  }

  let chat;
  try {
    chat = models.resolveChat();
  } catch {
    return { ok: false, reason: "unreadable" };
  }

  const req: ChatRequest = {
    messages: [
      { role: "system", content: SUMMARIZE_SYSTEM },
      { role: "user", content: markdown },
    ],
    tools: [],
  };

  let joined = "";
  try {
    for await (const chunk of chat.stream(req, signal)) {
      if (signal.aborted) {
        return { ok: false, reason: "aborted" };
      }
      if (chunk.type === "error") {
        return { ok: false, reason: "unreadable" };
      }
      if (chunk.type === "text") {
        joined += chunk.text;
      }
    }
  } catch {
    if (signal.aborted) {
      return { ok: false, reason: "aborted" };
    }
    return { ok: false, reason: "unreadable" };
  }

  if (signal.aborted) {
    return { ok: false, reason: "aborted" };
  }
  if (joined.length === 0) {
    return { ok: false, reason: "unreadable" };
  }
  return { ok: true, summary: joined.slice(0, SUMMARIZE_MAX_CHARS) };
}
