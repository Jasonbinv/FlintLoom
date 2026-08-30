import { childPath, fetchFiles, parentPath, type FileList } from "./files.ts";

const KNOWN_EXTENSIONS = [
  "infographic.json",
  "md",
  "markdown",
  "docx",
  "doc",
  "xlsx",
  "xls",
  "csv",
  "json",
  "py",
  "js",
  "ts",
  "tsx",
  "jsx",
  "png",
  "jpg",
  "jpeg",
  "svg",
  "yml",
  "yaml",
  "txt",
  "pdf",
  "html",
  "htm",
  "pptx",
];

const SEGMENT = String.raw`[\w@.\u4e00-\u9fff-]+`;
const PATH_BODY = `${SEGMENT}(?:/${SEGMENT})*`;
const EXT_ALT = KNOWN_EXTENSIONS.map((ext) =>
  ext.replaceAll(".", String.raw`\.`),
).join("|");
const FILE_PATH_RE = new RegExp(
  `(?:\`(${PATH_BODY}(?:\\.(?:${EXT_ALT})))\`|(?:^|[\\s(（「『"'])((?:${PATH_BODY})(?:\\.(?:${EXT_ALT})))(?=[\\s)）」』"'.，。:：!?！?]|$))`,
  "gim",
);

function normalizePath(raw: string): string | undefined {
  const path = raw.trim().replaceAll("\\", "/");
  if (!path || path.includes("://")) return undefined;
  if (path.startsWith("/") || path.startsWith("..")) return undefined;
  const lower = path.toLowerCase();
  const matched = KNOWN_EXTENSIONS.some(
    (ext) => lower === ext || lower.endsWith(`.${ext}`),
  );
  if (!matched) return undefined;
  return path;
}

export function extractFilePaths(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(FILE_PATH_RE)) {
    const candidate = normalizePath(match[1] ?? match[2] ?? "");
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    found.push(candidate);
  }
  return found;
}

export function fileBaseName(path: string): string {
  return path.replaceAll("\\", "/").split("/").pop() ?? path;
}

export async function keepExistingFilePaths(
  paths: string[],
  listDir: (dir: string) => Promise<FileList> = (dir) => fetchFiles(dir),
): Promise<string[]> {
  const unique = [...new Set(paths)];
  if (unique.length === 0) return [];
  const dirs = new Set(unique.map((path) => parentPath(path)));
  if (unique.some((path) => !path.includes("/"))) {
    dirs.add("ai_generation");
  }
  const present = new Set<string>();
  await Promise.all(
    [...dirs].map(async (dir) => {
      try {
        const { entries } = await listDir(dir);
        for (const entry of entries) {
          if (entry.type === "file") {
            present.add(childPath(dir, entry.name));
          } else if (dir === "ai_generation" && entry.type === "dir") {
            try {
              const nested = await listDir(childPath(dir, entry.name));
              for (const inner of nested.entries) {
                if (inner.type === "file") {
                  present.add(childPath(childPath(dir, entry.name), inner.name));
                }
              }
            } catch {
              // Missing generation folder: skip.
            }
          }
        }
      } catch {
        // Missing directory or host error: treat as no files.
      }
    }),
  );
  const resolved: string[] = [];
  const used = new Set<string>();
  for (const path of unique) {
    if (present.has(path)) {
      resolved.push(path);
      used.add(path);
      continue;
    }
    if (path.includes("/")) continue;
    const hits = [...present]
      .filter((item) => !used.has(item) && fileBaseName(item) === path)
      .sort()
      .reverse();
    const hit = hits[0];
    if (hit !== undefined) {
      resolved.push(hit);
      used.add(hit);
    }
  }
  return resolved;
}
