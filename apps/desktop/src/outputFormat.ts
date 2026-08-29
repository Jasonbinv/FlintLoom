export const OUTPUT_FORMATS = [
  { id: "docx", ext: ".docx", label: "Word" },
  { id: "xlsx", ext: ".xlsx", label: "Excel" },
  { id: "pptx", ext: ".pptx", label: "PPT" },
  { id: "md", ext: ".md", label: "Markdown" },
  { id: "html", ext: ".html", label: "HTML" },
  { id: "pdf", ext: ".pdf", label: "PDF" },
] as const;

export type OutputFormat = (typeof OUTPUT_FORMATS)[number]["id"];

const FORMAT_IDS = new Set<string>(OUTPUT_FORMATS.map((item) => item.id));

export function isOutputFormat(value: string): value is OutputFormat {
  return FORMAT_IDS.has(value);
}

export function outputFormatOf(id: OutputFormat): (typeof OUTPUT_FORMATS)[number] {
  const found = OUTPUT_FORMATS.find((item) => item.id === id);
  if (!found) {
    throw new Error(`unknown output format: ${id}`);
  }
  return found;
}

export function appendOutputFormatConstraint(
  text: string,
  format: OutputFormat,
): string {
  const item = outputFormatOf(format);
  const constraint =
    `本轮必须在工作区写出一份 ${item.label} 文件（扩展名 ${item.ext}）。` +
    `先用 fs 写 markdown 或 document JSON 源文件，再调用 doc_generate，out 必须以 ${item.ext} 结尾。` +
    `不要只在对话里回复正文。`;
  return text.length > 0 ? `${text}\n${constraint}` : constraint;
}

export function outPathFromToolResult(
  name: string,
  text: string,
  expected: OutputFormat,
): string | undefined {
  if (name !== "doc_generate" && name !== "doc_convert") {
    return undefined;
  }
  try {
    const parsed = JSON.parse(text) as {
      status?: unknown;
      out?: unknown;
      format?: unknown;
    };
    if (parsed.status !== "ok") return undefined;
    if (parsed.format !== expected) return undefined;
    if (typeof parsed.out !== "string" || parsed.out.length === 0) {
      return undefined;
    }
    return parsed.out.replaceAll("\\", "/");
  } catch {
    return undefined;
  }
}

export function formatFromSourcePath(path: string): OutputFormat | undefined {
  const lower = path.replaceAll("\\", "/").toLowerCase();
  if (lower.endsWith(".markdown")) return "md";
  for (const item of OUTPUT_FORMATS) {
    if (lower.endsWith(item.ext)) return item.id;
  }
  return undefined;
}

export function exportOutPath(sourcePath: string, format: OutputFormat): string {
  const normalized = sourcePath.replaceAll("\\", "/");
  const slash = normalized.lastIndexOf("/");
  const dir = slash >= 0 ? normalized.slice(0, slash + 1) : "";
  const name = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return `${dir}${stem}${outputFormatOf(format).ext}`;
}

export function exportTargets(sourcePath: string): OutputFormat[] {
  const current = formatFromSourcePath(sourcePath);
  if (current === undefined) return [];
  return OUTPUT_FORMATS.map((item) => item.id).filter((id) => id !== current);
}
