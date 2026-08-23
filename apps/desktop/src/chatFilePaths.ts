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
