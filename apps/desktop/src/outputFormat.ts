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

export function inferOutputFormats(text: string): OutputFormat[] {
  const found: OutputFormat[] = [];
  const add = (id: OutputFormat) => {
    if (!found.includes(id)) found.push(id);
  };
  if (/\bdocx?\b|\bword\b/i.test(text)) add("docx");
  if (/\bpptx?\b|幻灯片|powerpoint/i.test(text)) add("pptx");
  if (/\bxlsx?\b|\bexcel\b/i.test(text)) add("xlsx");
  if (/\bpdf\b/i.test(text)) add("pdf");
  if (/\bhtml\b/i.test(text)) add("html");
  return found;
}

export function appendOutputFormatConstraint(
  text: string,
  format: OutputFormat,
): string {
  const item = outputFormatOf(format);
  const constraint =
    `本轮必须在工作区写出一份 ${item.label} 文件（扩展名 ${item.ext}）。` +
    `若本次对话已有 markdown，直接用它作 source 调用 doc_generate；没有再先用 fs 写一个 markdown（只要文件名，不要自己拼日期目录，不要用 shell mkdir）。` +
    `不要只在对话里回复正文。`;
  return text.length > 0 ? `${text}\n${constraint}` : constraint;
}

export function appendOutputFormatConstraints(
  text: string,
  formats: OutputFormat[],
): string {
  if (formats.length === 0) return text;
  if (formats.length === 1) {
    return appendOutputFormatConstraint(text, formats[0]!);
  }
  const labels = formats
    .map((id) => {
      const item = outputFormatOf(id);
      return `${item.label}（${item.ext}）`;
    })
    .join("、");
  const constraint =
    `本轮必须在工作区写出 ${labels}。` +
    `若本次对话已有 markdown，直接用它作 source 分别调用 doc_generate；没有再先用 fs 写一个 markdown（只要文件名，不要自己拼日期目录，不要用 shell mkdir）。` +
    `不要只写 md 就结束，也不要只在对话里回复正文。`;
  return text.length > 0 ? `${text}\n${constraint}` : constraint;
}

export function stripOutputFormatConstraint(text: string): string {
  const idx = text.search(/\n本轮必须在工作区写出/);
  if (idx === -1) return text;
  return text.slice(0, idx);
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
