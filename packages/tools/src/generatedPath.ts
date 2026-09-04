import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

const ILLEGAL = /[\\/:*?"<>|\n\r，。、：；！？,.!?;'`~()（）[\]【】{}]+/g;
const LEGACY_TYPE_DIRS = new Set(["md", "html", "docx", "PPT", "pdf", "xlsx", "py"]);
const TOPIC_MAX = 8;

const TOPIC_PHRASES = [
  "做成一个word和ppt",
  "写成word和ppt",
  "做成一份",
  "写成一份",
  "做一份",
  "写一份",
  "写成一个",
  "做成一个",
  "写一个关于",
  "做一个关于",
  "写一个",
  "做一个",
  "写成",
  "做成",
  "的文案",
  "的内容",
  "的介绍",
  "中关于",
  "关于",
  "帮我",
  "请你",
  "请",
  "把",
];

const FORMAT_WORDS = [
  "powerpoint",
  "markdown",
  "excel",
  "docx",
  "pptx",
  "xlsx",
  "html",
  "pdf",
  "ppt",
  "word",
  "doc",
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceAllInsensitive(input: string, needles: readonly string[]): string {
  let next = input;
  for (const needle of needles) {
    next = next.replace(new RegExp(escapeRegExp(needle), "ig"), "");
  }
  return next;
}

function stripTopicBoilerplate(text: string): string {
  let current = text.trim().replace(ILLEGAL, "").replace(/\s+/g, "");
  for (let i = 0; i < 16; i += 1) {
    const stripped = replaceAllInsensitive(
      replaceAllInsensitive(current, TOPIC_PHRASES),
      FORMAT_WORDS,
    )
      .replace(/^和+|和+$/g, "")
      .replace(/和{2,}/g, "和");
    if (stripped === current) break;
    current = stripped;
  }
  return current;
}

function normalizeRel(rel: string): string {
  return rel.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function slugGenerationTopic(text: string): string {
  const slice = stripTopicBoilerplate(text).slice(0, TOPIC_MAX);
  return slice.length > 0 ? slice : "chat";
}

export function formatGenerationDate(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function generationDirFromTopic(topic: string, startedAt: number): string {
  return `ai_generation/${formatGenerationDate(startedAt)}_${slugGenerationTopic(topic)}`;
}

export function placeGeneratedRelPath(rel: string, generationDir?: string): string {
  const normalized = normalizeRel(rel);
  if (!generationDir) return normalized;
  if (!normalized || normalized.startsWith(".")) return normalized;
  if (normalized === generationDir || normalized.startsWith(`${generationDir}/`)) {
    return normalized;
  }
  if (normalized.startsWith("ai_generation/")) {
    const base = normalized.split("/").pop() ?? "";
    if (!base || base.startsWith(".")) return normalized;
    return `${generationDir}/${base}`;
  }
  if (!normalized.includes("/")) return `${generationDir}/${normalized}`;
  const parts = normalized.split("/");
  if (parts.length === 2 && LEGACY_TYPE_DIRS.has(parts[0] ?? "")) {
    return `${generationDir}/${parts[1]}`;
  }
  return normalized;
}

export function routeGeneratedWriteRel(
  rel: string,
  workspaceRoot: string,
  generationDir?: string,
): string {
  const normalized = normalizeRel(rel);
  const placed = placeGeneratedRelPath(normalized, generationDir);
  if (placed === normalized) return normalized;
  try {
    if (statSync(join(workspaceRoot, normalized)).isFile()) return normalized;
  } catch {
    // missing or not a file — place into the generation dir
  }
  return placed;
}

export function preferExistingGeneratedRel(
  rel: string,
  workspaceRoot: string,
  generationDir?: string,
): string {
  const normalized = normalizeRel(rel);
  if (existsSync(join(workspaceRoot, normalized))) return normalized;
  const placed = placeGeneratedRelPath(normalized, generationDir);
  if (placed !== normalized && existsSync(join(workspaceRoot, placed))) {
    return placed;
  }
  return normalized;
}
