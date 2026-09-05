export type A2uiExportSection =
  | { kind: "markdown"; content: string }
  | { kind: "datatable"; componentId: string; title?: string; headers: string[]; rows: string[][] }
  | {
      kind: "chart";
      componentId: string;
      title: string;
      labels: string[];
      values: number[];
      yLabels?: string[];
      matrix?: number[][];
    };

const LAYOUT_COMPONENTS = new Set(["Column", "Row", "Card", "List", "Tabs", "Modal"]);

type Comp = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bindingPath(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value.path !== "string") return undefined;
  if (Object.keys(value).length !== 1) return undefined;
  return value.path;
}

function getAtPath(root: unknown, path: string): unknown {
  if (path === "/" || path === "") return root;
  const segs = path.split("/").filter((s) => s.length > 0);
  let cursor: unknown = root;
  for (const key of segs) {
    if (!isRecord(cursor) || !(key in cursor)) return undefined;
    cursor = cursor[key];
  }
  return cursor;
}

function setAtPath(root: unknown, path: string, value: unknown): unknown {
  if (path === "/" || path === "") return value;
  const segs = path.split("/").filter((s) => s.length > 0);
  const nextRoot: Record<string, unknown> = isRecord(root) ? { ...root } : {};
  let cursor = nextRoot;
  for (let i = 0; i < segs.length - 1; i++) {
    const key = segs[i]!;
    const child = isRecord(cursor[key]) ? { ...cursor[key] } : {};
    cursor[key] = child;
    cursor = child;
  }
  const last = segs[segs.length - 1];
  if (last !== undefined) cursor[last] = value;
  return nextRoot;
}

export function collectLatestA2uiComponents(messages: unknown[]): Map<string, Comp> {
  const map = new Map<string, Comp>();
  if (!Array.isArray(messages)) return map;
  for (const message of messages) {
    if (!isRecord(message) || !isRecord(message.updateComponents)) continue;
    const components = message.updateComponents.components;
    if (!Array.isArray(components)) continue;
    for (const item of components) {
      if (!isRecord(item) || typeof item.id !== "string") continue;
      map.set(item.id, item);
    }
  }
  return map;
}

export function applyA2uiDataModel(messages: unknown[]): unknown {
  let model: unknown = {};
  if (!Array.isArray(messages)) return model;
  for (const message of messages) {
    if (!isRecord(message) || !isRecord(message.updateDataModel)) continue;
    const path =
      typeof message.updateDataModel.path === "string" ? message.updateDataModel.path : "/";
    model = setAtPath(model, path, message.updateDataModel.value);
  }
  return model;
}

export function surfaceIdOf(messages: unknown[]): string {
  if (!Array.isArray(messages)) return "a2ui-report";
  for (const message of messages) {
    if (!isRecord(message) || !isRecord(message.createSurface)) continue;
    if (typeof message.createSurface.surfaceId === "string" && message.createSurface.surfaceId) {
      return message.createSurface.surfaceId;
    }
  }
  return "a2ui-report";
}

function childIdsOf(comp: Comp): string[] {
  const ids: string[] = [];
  if (Array.isArray(comp.children)) {
    for (const child of comp.children) {
      if (typeof child === "string" && child.trim()) ids.push(child.trim());
    }
  }
  if (typeof comp.child === "string" && comp.child.trim()) ids.push(comp.child.trim());
  else if (Array.isArray(comp.child)) {
    for (const child of comp.child) {
      if (typeof child === "string" && child.trim()) ids.push(child.trim());
    }
  }
  return ids;
}

function findRootComponentId(map: Map<string, Comp>): string | null {
  if (map.has("root")) return "root";
  const referenced = new Set<string>();
  for (const comp of map.values()) {
    for (const childId of childIdsOf(comp)) referenced.add(childId);
  }
  for (const id of map.keys()) {
    if (!referenced.has(id)) return id;
  }
  const first = map.keys().next();
  return first.done ? null : first.value;
}

function boundText(text: unknown, model: unknown): string {
  if (typeof text === "string") return text;
  const path = bindingPath(text);
  if (!path) return "";
  const value = getAtPath(model, path);
  if (typeof value === "string") return value;
  if (value == null) return "";
  return String(value);
}

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function parseStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const labels = value.filter((item): item is string => typeof item === "string");
  return labels.length === value.length ? labels : undefined;
}

function parseNumberList(value: unknown, expected?: number): number[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const values: number[] = [];
  for (const item of value) {
    const n = asFiniteNumber(item);
    if (n === undefined) return undefined;
    values.push(n);
  }
  if (expected !== undefined && values.length !== expected) return undefined;
  return values;
}

function firstSeriesValues(data: Record<string, unknown>): unknown {
  if (!Array.isArray(data.series)) return undefined;
  for (const item of data.series) {
    if (isRecord(item) && Array.isArray(item.data)) return item.data;
  }
  return undefined;
}

function parsePairList(source: unknown[]): { labels: string[]; values: number[] } | undefined {
  const labels: string[] = [];
  const values: number[] = [];
  for (const item of source) {
    if (Array.isArray(item) && item.length >= 2 && typeof item[0] === "string") {
      const n = asFiniteNumber(item[1]);
      if (n === undefined) return undefined;
      labels.push(item[0]);
      values.push(n);
      continue;
    }
    if (isRecord(item)) {
      const label =
        typeof item.label === "string"
          ? item.label
          : typeof item.name === "string"
            ? item.name
            : typeof item.key === "string"
              ? item.key
              : undefined;
      const n = asFiniteNumber(item.value ?? item.y ?? item.count);
      if (label === undefined || n === undefined) return undefined;
      labels.push(label);
      values.push(n);
      continue;
    }
    return undefined;
  }
  return labels.length > 0 ? { labels, values } : undefined;
}

function parseSeriesChart(source: unknown): { labels: string[]; values: number[] } | undefined {
  if (Array.isArray(source)) return parsePairList(source);
  if (!isRecord(source)) return undefined;
  const labels = parseStringList(source.labels) ?? parseStringList(source.categories);
  const values =
    parseNumberList(source.values, labels?.length) ??
    (labels ? parseNumberList(firstSeriesValues(source), labels.length) : undefined);
  if (labels && values && labels.length === values.length) return { labels, values };

  const mapLabels: string[] = [];
  const mapValues: number[] = [];
  for (const [key, value] of Object.entries(source)) {
    if (key === "kind" || key === "type" || key === "component" || key === "id") continue;
    const n = asFiniteNumber(value);
    if (n === undefined) continue;
    mapLabels.push(key);
    mapValues.push(n);
  }
  return mapLabels.length > 0 ? { labels: mapLabels, values: mapValues } : undefined;
}

function parseHeatmapMatrix(
  raw: unknown,
): { xLabels: string[]; yLabels: string[]; values: number[][] } | undefined {
  if (!isRecord(raw)) return undefined;
  const xLabels = Array.isArray(raw.xLabels)
    ? raw.xLabels.filter((l): l is string => typeof l === "string")
    : [];
  const yLabels = Array.isArray(raw.yLabels)
    ? raw.yLabels.filter((l): l is string => typeof l === "string")
    : [];
  if (xLabels.length === 0 || yLabels.length === 0 || !Array.isArray(raw.values)) {
    return undefined;
  }
  const values: number[][] = [];
  for (const row of raw.values) {
    if (!Array.isArray(row) || row.length !== xLabels.length) return undefined;
    const cells: number[] = [];
    for (const cell of row) {
      const n = asFiniteNumber(cell);
      if (n === undefined) return undefined;
      cells.push(n);
    }
    values.push(cells);
  }
  if (values.length !== yLabels.length) return undefined;
  return { xLabels, yLabels, values };
}

function resolveTable(
  comp: Comp,
  model: unknown,
): { headers: string[]; rows: string[][] } | undefined {
  const path = bindingPath(comp.data);
  const source = path ? getAtPath(model, path) : comp;
  if (!isRecord(source)) return undefined;
  const headers = source.headers;
  const rows = source.rows;
  if (
    Array.isArray(headers) &&
    headers.every((h) => typeof h === "string") &&
    Array.isArray(rows) &&
    rows.every((row) => Array.isArray(row) && row.every((c) => typeof c === "string"))
  ) {
    return { headers: headers as string[], rows: rows as string[][] };
  }
  return undefined;
}

function resolveChartSource(comp: Comp, model: unknown): unknown {
  const path = bindingPath(comp.data);
  if (path) return getAtPath(model, path);
  if (isRecord(comp.data) && !bindingPath(comp.data)) return comp.data;
  return comp;
}

function escapeMarkdownCell(value: unknown): string {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ")
    .trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function collectA2uiExportSections(
  messages: unknown[],
  model?: unknown,
): A2uiExportSection[] {
  const map = collectLatestA2uiComponents(messages);
  const rootId = findRootComponentId(map);
  if (!rootId) return [];
  const resolvedModel = model === undefined ? applyA2uiDataModel(messages) : model;
  const visited = new Set<string>();
  return walkExportSections(rootId, map, visited, resolvedModel);
}

function walkExportSections(
  componentId: string,
  map: Map<string, Comp>,
  visited: Set<string>,
  model: unknown,
): A2uiExportSection[] {
  if (visited.has(componentId)) return [];
  visited.add(componentId);
  const comp = map.get(componentId);
  if (!comp) return [];

  const kind = String(comp.component || "").trim();
  const sections: A2uiExportSection[] = [];

  if (LAYOUT_COMPONENTS.has(kind)) {
    for (const childId of childIdsOf(comp)) {
      sections.push(...walkExportSections(childId, map, visited, model));
    }
    return sections;
  }

  if (kind === "Divider") {
    sections.push({ kind: "markdown", content: "---" });
    return sections;
  }

  if (kind === "Markdown" || kind === "Text") {
    const text = boundText(comp.text ?? comp.markdown, model).trim();
    if (text) {
      const variant = String(comp.variant || "").toLowerCase();
      let content = text;
      if (/^h[1-6]$/.test(variant)) {
        const level = Math.min(6, Math.max(1, Number.parseInt(variant.slice(1), 10) || 4));
        content = `${"#".repeat(level)} ${text}`;
      }
      sections.push({ kind: "markdown", content });
    }
    return sections;
  }

  if (kind === "DataTable") {
    const table = resolveTable(comp, model);
    const title = String(comp.title ?? "").trim();
    if (table) sections.push({ kind: "datatable", componentId, title: title || undefined, ...table });
    return sections;
  }

  if (kind === "Chart") {
    const source = resolveChartSource(comp, model);
    const heat = parseHeatmapMatrix(source) ?? parseHeatmapMatrix(comp);
    if (heat) {
      sections.push({
        kind: "chart",
        componentId,
        title: String(comp.title ?? "").trim(),
        labels: heat.xLabels,
        values: [],
        yLabels: heat.yLabels,
        matrix: heat.values,
      });
      return sections;
    }
    const series = parseSeriesChart(source) ?? parseSeriesChart(comp);
    if (series) {
      sections.push({
        kind: "chart",
        componentId,
        title: String(comp.title ?? "").trim(),
        labels: series.labels,
        values: series.values,
      });
    }
    return sections;
  }

  for (const childId of childIdsOf(comp)) {
    sections.push(...walkExportSections(childId, map, visited, model));
  }
  return sections;
}

function markdownTable(headers: string[], rows: string[][]): string {
  if (headers.length === 0) return "";
  const header = headers.map(escapeMarkdownCell).join(" | ");
  const separator = headers.map(() => "---").join(" | ");
  const body = rows.map((row) =>
    headers.map((_, idx) => escapeMarkdownCell(row[idx] ?? "")).join(" | "),
  );
  return [`| ${header} |`, `| ${separator} |`, ...body.map((line) => `| ${line} |`)].join("\n");
}

function chartSectionToMarkdown(section: Extract<A2uiExportSection, { kind: "chart" }>): string {
  const heading = section.title ? `### ${section.title}\n\n` : "";
  if (section.matrix && section.yLabels) {
    const headers = ["", ...section.labels];
    const rows = section.yLabels.map((y, i) => [
      y,
      ...(section.matrix?.[i]?.map((n) => String(n)) ?? []),
    ]);
    return `${heading}${markdownTable(headers, rows)}`;
  }
  return `${heading}${markdownTable(["类别", "数值"], section.labels.map((label, i) => [label, String(section.values[i] ?? "")]))}`;
}

export type BuildA2uiSurfaceMarkdownOptions = {
  includeChartImages?: boolean;
  chartVisualFootnote?: boolean;
};

function chartVisualFootnoteMarkdown(title: string): string {
  const label = title || "图表";
  return `> *${label}：可视化图请使用「复制」粘贴到 Word/飞书，或「导出 HTML」查看。*`;
}

export function buildA2uiSurfaceMarkdown(
  messages: unknown[],
  chartPngByComponentId: Record<string, string> = {},
  options: BuildA2uiSurfaceMarkdownOptions = {},
  model?: unknown,
): string {
  const includeChartImages = options.includeChartImages ?? false;
  const chartVisualFootnote = options.chartVisualFootnote ?? !includeChartImages;
  const parts: string[] = [];
  for (const section of collectA2uiExportSections(messages, model)) {
    if (section.kind === "markdown") {
      parts.push(section.content);
      continue;
    }
    if (section.kind === "datatable") {
      const table = markdownTable(section.headers, section.rows);
      if (table) parts.push(section.title ? `### ${section.title}\n\n${table}` : table);
      continue;
    }
    const dataTable = chartSectionToMarkdown(section);
    const png = chartPngByComponentId[section.componentId];
    const chartParts: string[] = [];
    if (dataTable) chartParts.push(dataTable);
    if (includeChartImages && png) {
      chartParts.push(`![${section.title || "图表"}](${png})`);
    } else if (chartVisualFootnote) {
      chartParts.push(chartVisualFootnoteMarkdown(section.title));
    }
    if (chartParts.length > 0) parts.push(chartParts.join("\n\n"));
  }
  return parts.filter(Boolean).join("\n\n").trim();
}

export function normalizeEmojiKeycapListsForWord(markdown: string): string {
  if (!markdown) return markdown;
  const keycapLine = /^(\s*)(?:[-*+]\s+)?((?:[0-9]\uFE0F?\u20E3|🔟))\uFE0F?\s+(.*)$/u;
  return markdown
    .split("\n")
    .map((line) => {
      const match = line.match(keycapLine);
      if (!match) return line;
      const [, indent, keycap, rest] = match;
      const n = keycap.includes("🔟") ? 10 : Number.parseInt(keycap.replace(/[^\d]/g, ""), 10);
      if (!Number.isFinite(n) || n < 1) return line;
      return `${indent}${n}. ${rest}`;
    })
    .join("\n");
}

const WORD_PASTE_WIDTH = 540;
const HTML_EXPORT_WIDTH = 1100;
const WORD_FONT_STACK = "'Microsoft YaHei', 'PingFang SC', 'Segoe UI', sans-serif";

const EMOJI_RE =
  /\p{Extended_Pictographic}(?:\uFE0F\u20E3|\uFE0F|\u200D\p{Extended_Pictographic}\uFE0F?)*/gu;

function inlineMarkdownToHtml(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(
      EMOJI_RE,
      (emoji) =>
        `<span style="font-family:'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',sans-serif">${emoji}</span>`,
    );
}

function splitTableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isMarkdownTableSeparatorLine(line: string): boolean {
  const cells = splitTableCells(line).filter(Boolean);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isMarkdownTableRowLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return false;
  if (isMarkdownTableSeparatorLine(trimmed)) return false;
  return (
    trimmed.startsWith("|") ||
    trimmed.endsWith("|") ||
    /[^|\s].*\|.*[^|\s]/.test(trimmed) ||
    /^\S+\s*\|\s*\S+/.test(trimmed)
  );
}

function wrapWordPasteBlock(innerHtml: string): string {
  return [
    `<table role="presentation" border="0" cellspacing="0" cellpadding="0" align="center" width="${WORD_PASTE_WIDTH}"`,
    ` style="width:${WORD_PASTE_WIDTH}px;max-width:${WORD_PASTE_WIDTH}px;margin:12px auto;border-collapse:collapse;">`,
    '<tr><td align="center" style="text-align:center;padding:0;">',
    innerHtml,
    "</td></tr></table>",
  ].join("");
}

function markdownTableBlockToHtml(block: string, wordPaste: boolean): string {
  const lines = block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return `<pre>${escapeHtml(block)}</pre>`;
  const headerCells = splitTableCells(lines[0]!).filter(Boolean);
  const bodyLines = isMarkdownTableSeparatorLine(lines[1] ?? "") ? lines.slice(2) : lines.slice(1);
  const colCount = Math.max(headerCells.length, 1);
  const colWidthPct = Math.floor(100 / colCount);
  const colgroup = `<colgroup>${Array.from({ length: colCount }, () => `<col style="width:${colWidthPct}%" />`).join("")}</colgroup>`;
  const headerCellStyle =
    "text-align:center;color:#111827;background:#f3f4f6;font-weight:700;font-size:11pt;font-family:Microsoft YaHei,PingFang SC,Segoe UI,sans-serif;border:1px solid #d1d5db;padding:6pt 8pt;";
  const bodyCellStyle =
    "text-align:center;color:#111827;background:#ffffff;font-size:11pt;font-family:Microsoft YaHei,PingFang SC,Segoe UI,sans-serif;border:1px solid #d1d5db;padding:6pt 8pt;";
  const thead = `<thead><tr>${headerCells.map((cell) => `<th style="${headerCellStyle}">${inlineMarkdownToHtml(cell)}</th>`).join("")}</tr></thead>`;
  const tbody = bodyLines
    .map((line) => {
      const cells = splitTableCells(line);
      return `<tr>${cells.map((cell) => `<td style="${bodyCellStyle}">${inlineMarkdownToHtml(cell)}</td>`).join("")}</tr>`;
    })
    .join("");
  if (wordPaste) {
    const table = [
      `<table border="1" cellpadding="6" cellspacing="0" align="center" width="${WORD_PASTE_WIDTH}"`,
      ` style="width:${WORD_PASTE_WIDTH}px;max-width:${WORD_PASTE_WIDTH}px;border-collapse:collapse;margin:12px auto;table-layout:fixed;color:#111827;font-family:Microsoft YaHei,PingFang SC,Segoe UI,sans-serif;">`,
      colgroup,
      thead,
      `<tbody>${tbody}</tbody></table>`,
    ].join("");
    return wrapWordPasteBlock(table);
  }
  return [
    `<table border="1" cellpadding="6" cellspacing="0" align="center"`,
    ` style="border-collapse:collapse;width:100%;margin:12px auto;table-layout:fixed;color:#111827;font-family:Microsoft YaHei,PingFang SC,Segoe UI,sans-serif;">`,
    colgroup,
    thead,
    `<tbody>${tbody}</tbody></table>`,
  ].join("");
}

export function markdownToHtmlForA2uiExport(block: string, wordPaste = false): string {
  const lines = block.replace(/\r\n/g, "\n").split("\n");
  const parts: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const trimmed = lines[i]!.trim();
    if (!trimmed) {
      i += 1;
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1]!.length;
      parts.push(`<h${level}>${inlineMarkdownToHtml(heading[2]!)}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      parts.push("<hr/>");
      i += 1;
      continue;
    }

    if (
      isMarkdownTableRowLine(trimmed) &&
      i + 1 < lines.length &&
      isMarkdownTableSeparatorLine(lines[i + 1]!.trim())
    ) {
      const tableLines: string[] = [trimmed, lines[i + 1]!.trim()];
      i += 2;
      while (i < lines.length) {
        const row = lines[i]!.trim();
        if (!row || !isMarkdownTableRowLine(row)) break;
        tableLines.push(row);
        i += 1;
      }
      parts.push(markdownTableBlockToHtml(tableLines.join("\n"), wordPaste));
      continue;
    }

    if (/^[-*+]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i]!.trim())) {
        items.push(lines[i]!.trim().replace(/^[-*+]\s+/, ""));
        i += 1;
      }
      parts.push(`<ul>${items.map((item) => `<li>${inlineMarkdownToHtml(item)}</li>`).join("")}</ul>`);
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i]!.trim())) {
        items.push(lines[i]!.trim().replace(/^\d+\.\s+/, ""));
        i += 1;
      }
      parts.push(`<ol>${items.map((item) => `<li>${inlineMarkdownToHtml(item)}</li>`).join("")}</ol>`);
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]!.trim())) {
        quoteLines.push(lines[i]!.trim().replace(/^>\s?/, ""));
        i += 1;
      }
      parts.push(
        `<blockquote><p>${quoteLines.map((line) => inlineMarkdownToHtml(line)).join("<br/>")}</p></blockquote>`,
      );
      continue;
    }

    const paragraphLines: string[] = [];
    while (i < lines.length) {
      const next = lines[i]!.trim();
      if (!next) break;
      if (/^(#{1,6})\s+/.test(next)) break;
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(next)) break;
      if (/^[-*+]\s+/.test(next)) break;
      if (/^\d+\.\s+/.test(next)) break;
      if (/^>\s?/.test(next)) break;
      if (
        isMarkdownTableRowLine(next) &&
        i + 1 < lines.length &&
        isMarkdownTableSeparatorLine(lines[i + 1]!.trim())
      ) {
        break;
      }
      paragraphLines.push(next);
      i += 1;
    }
    if (paragraphLines.length > 0) {
      parts.push(`<p>${paragraphLines.map((line) => inlineMarkdownToHtml(line)).join("<br/>")}</p>`);
    }
  }

  return parts.join("\n");
}

function chartFigureHtml(png: string | undefined, title: string, wordPaste: boolean): string {
  if (!png) return "";
  const alt = escapeHtml(title || "图表");
  if (wordPaste) {
    const img = [
      `<img src="${png}" alt="${alt}" width="${WORD_PASTE_WIDTH}"`,
      ` style="width:${WORD_PASTE_WIDTH}px;max-width:${WORD_PASTE_WIDTH}px;height:auto;display:block;margin:0 auto;border:1px solid #e5e7eb;" />`,
    ].join(" ");
    return wrapWordPasteBlock(img);
  }
  return `<figure style="margin:16px 0;text-align:center"><img src="${png}" alt="${alt}" width="${HTML_EXPORT_WIDTH}" style="width:100%;max-width:${HTML_EXPORT_WIDTH}px;height:auto;display:block;margin:0 auto;border:1px solid #e5e7eb;border-radius:8px"/></figure>`;
}

export type A2uiHtmlRenderOptions = {
  wordPaste?: boolean;
};

function buildA2uiSurfaceHtmlParts(
  messages: unknown[],
  chartPngByComponentId: Record<string, string>,
  options: A2uiHtmlRenderOptions = {},
  model?: unknown,
): string[] {
  const wordPaste = options.wordPaste ?? false;
  const parts: string[] = [];
  for (const section of collectA2uiExportSections(messages, model)) {
    if (section.kind === "markdown") {
      parts.push(markdownToHtmlForA2uiExport(section.content, wordPaste));
      continue;
    }
    if (section.kind === "datatable") {
      const heading = section.title ? `<h3>${escapeHtml(section.title)}</h3>` : "";
      const table = markdownTable(section.headers, section.rows);
      if (table) parts.push([heading, markdownToHtmlForA2uiExport(table, wordPaste)].filter(Boolean).join("\n"));
      continue;
    }
    const heading = section.title ? `<h3>${escapeHtml(section.title)}</h3>` : "";
    const table = markdownToHtmlForA2uiExport(
      chartSectionToMarkdown({ ...section, title: "" }),
      wordPaste,
    );
    const figure = chartFigureHtml(chartPngByComponentId[section.componentId], section.title, wordPaste);
    parts.push([heading, table, figure].filter(Boolean).join("\n"));
  }
  return parts.filter(Boolean);
}

export function buildA2uiSurfaceHtmlBody(
  messages: unknown[],
  chartPngByComponentId: Record<string, string> = {},
  options: A2uiHtmlRenderOptions = {},
  model?: unknown,
): string {
  return buildA2uiSurfaceHtmlParts(messages, chartPngByComponentId, options, model).join("\n");
}

export function buildA2uiSurfaceHtmlDocument(
  messages: unknown[],
  chartPngByComponentId: Record<string, string> = {},
  title = "A2UI 报告",
  options: A2uiHtmlRenderOptions = {},
  model?: unknown,
): string {
  const wordPaste = options.wordPaste ?? false;
  const body = buildA2uiSurfaceHtmlBody(messages, chartPngByComponentId, options, model);
  const maxWidth = wordPaste ? WORD_PASTE_WIDTH : HTML_EXPORT_WIDTH;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif; line-height: 1.65; color: #111827; max-width: ${maxWidth}px; margin: 24px auto; padding: 0 16px; }
    table { font-size: 14px; width: 100%; color: #111827; border-collapse: collapse; }
    th, td { color: #111827; border: 1px solid #d1d5db; padding: 8px 10px; }
    th { background: #f3f4f6; font-weight: 700; text-align: center; }
    h1,h2,h3,h4,h5,h6 { margin-top: 1.2em; margin-bottom: 0.5em; }
    p { margin: 0.5em 0; }
    img { max-width: 100%; height: auto; display: block; margin: 0 auto; }
  </style>
</head>
<body>
${body}
</body>
</html>`;
}

export function wrapHtmlForWordClipboard(bodyHtml: string): string {
  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8"/>
<meta name="ProgId" content="Word.Document"/>
<meta name="Generator" content="FlintLoom A2UI"/>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>
body { font-family: ${WORD_FONT_STACK}; font-size: 11pt; line-height: 1.6; color: #111827; }
h1,h2,h3,h4,h5,h6 { margin: 12pt 0 6pt; }
p { margin: 6pt 0; }
table { border-collapse: collapse; color: #111827; }
th, td { padding: 6pt 8pt; color: #111827; border: 1px solid #d1d5db; font-size: 11pt; }
th { background: #f3f4f6; font-weight: 700; }
</style>
</head>
<body>
<!--StartFragment-->
<div style="font-family:${WORD_FONT_STACK};font-size:11pt;line-height:1.6;color:#111827;">
${bodyHtml}
</div>
<!--EndFragment-->
</body>
</html>`;
}

export function suggestA2uiExportFilename(
  messages: unknown[],
  ext: "md" | "html" | "docx" | "doc",
  model?: unknown,
): string {
  const sections = collectA2uiExportSections(messages, model);
  for (const section of sections) {
    if (section.kind !== "markdown") continue;
    const heading = section.content.match(/^\s{0,3}#{1,6}\s+(.+?)\s*$/m);
    const line = (heading?.[1] ?? section.content.split("\n").find((item) => item.trim()) ?? "").trim();
    if (!line) continue;
    const slug = line
      .replace(/^#+\s+/, "")
      .replace(/[^\w\u4e00-\u9fff\u3400-\u4dbf.-]+/gu, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 56);
    if (slug) return `${slug}.${ext}`;
  }
  const slug =
    surfaceIdOf(messages)
      .replace(/[^\w.-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "a2ui-report";
  return `${slug}.${ext}`;
}

export type SaveTextFileOutcome = "saved" | "downloaded" | "cancelled";

function isSavePickerAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function savePickerTypes(
  ext: "md" | "html" | "docx" | "doc",
): Array<{ description: string; accept: Record<string, string[]> }> {
  if (ext === "html") {
    return [{ description: "HTML Document", accept: { "text/html": [".html", ".htm"] } }];
  }
  if (ext === "docx") {
    return [
      {
        description: "Word Document",
        accept: {
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
        },
      },
    ];
  }
  if (ext === "doc") {
    return [{ description: "Word Document", accept: { "application/msword": [".doc"] } }];
  }
  return [{ description: "Markdown Document", accept: { "text/markdown": [".md", ".markdown"] } }];
}

async function saveBlobFileWithPicker(
  filename: string,
  blob: Blob,
  mimeType: string,
): Promise<SaveTextFileOutcome> {
  const lower = filename.toLowerCase();
  const ext = lower.endsWith(".docx")
    ? "docx"
    : lower.endsWith(".doc")
      ? "doc"
      : lower.endsWith(".html")
        ? "html"
        : "md";

  const picker = (
    window as Window & {
      showSaveFilePicker?: (options: {
        suggestedName?: string;
        types?: Array<{ description: string; accept: Record<string, string[]> }>;
      }) => Promise<{
        createWritable: () => Promise<{
          write: (data: Blob) => Promise<void>;
          close: () => Promise<void>;
        }>;
      }>;
    }
  ).showSaveFilePicker;

  if (typeof picker === "function") {
    try {
      const handle = await picker({
        suggestedName: filename,
        types: savePickerTypes(ext),
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return "saved";
    } catch (error) {
      if (isSavePickerAbort(error)) return "cancelled";
    }
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
  return "downloaded";
}

export async function saveTextFileWithPicker(
  filename: string,
  content: string,
  mimeType: string,
): Promise<SaveTextFileOutcome> {
  return saveBlobFileWithPicker(filename, new Blob([content], { type: `${mimeType};charset=utf-8` }), mimeType);
}

export async function saveBinaryFileWithPicker(
  filename: string,
  bytes: Uint8Array,
  mimeType: string,
): Promise<SaveTextFileOutcome> {
  const copy = new Uint8Array(bytes);
  return saveBlobFileWithPicker(filename, new Blob([copy], { type: mimeType }), mimeType);
}

function svgPixelSize(svg: SVGSVGElement): { width: number; height: number } {
  let width = 0;
  let height = 0;
  try {
    width = svg.viewBox.baseVal.width;
    height = svg.viewBox.baseVal.height;
  } catch {
    width = 0;
    height = 0;
  }
  if (!width) width = svg.clientWidth || Number.parseFloat(svg.getAttribute("width") ?? "") || 640;
  if (!height) height = svg.clientHeight || Number.parseFloat(svg.getAttribute("height") ?? "") || 240;
  return { width: Math.max(1, width), height: Math.max(1, height) };
}

function usableCssColor(value: string): boolean {
  return Boolean(value) && value !== "none" && value !== "transparent" && !value.includes("rgba(0, 0, 0, 0)");
}

function serializeSvgForExport(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const originals = [svg, ...Array.from(svg.querySelectorAll("*"))];
  const clones = [clone, ...Array.from(clone.querySelectorAll("*"))];
  originals.forEach((el, index) => {
    const dest = clones[index];
    if (!(dest instanceof Element)) return;
    const cs = getComputedStyle(el);
    const fillAttr = el.getAttribute("fill") ?? "";
    if (fillAttr !== "none" && usableCssColor(cs.fill)) dest.setAttribute("fill", cs.fill);
    const strokeAttr = el.getAttribute("stroke") ?? "";
    if (strokeAttr !== "none" && usableCssColor(cs.stroke)) dest.setAttribute("stroke", cs.stroke);
    if (usableCssColor(cs.color)) dest.setAttribute("color", cs.color);
  });
  const { width, height } = svgPixelSize(svg);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(Math.round(width)));
  clone.setAttribute("height", String(Math.round(height)));
  return new XMLSerializer().serializeToString(clone);
}

export function svgToVisualDataUrl(svg: SVGSVGElement): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serializeSvgForExport(svg))}`;
}

function svgToPngDataUrl(svg: SVGSVGElement): Promise<string | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | undefined) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      const xml = serializeSvgForExport(svg);
      const href = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
      const image = new Image();
      const timer = window.setTimeout(() => finish(undefined), 2000);
      image.onload = () => {
        window.clearTimeout(timer);
        try {
          const { width, height } = svgPixelSize(svg);
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(width * 2);
          canvas.height = Math.round(height * 2);
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            finish(undefined);
            return;
          }
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
          finish(canvas.toDataURL("image/png"));
        } catch {
          finish(undefined);
        }
      };
      image.onerror = () => {
        window.clearTimeout(timer);
        finish(undefined);
      };
      image.src = href;
      if (image.complete && image.naturalWidth === 0) {
        window.clearTimeout(timer);
        finish(undefined);
      }
    } catch {
      finish(undefined);
    }
  });
}

function shouldRasterizeSvgToPng(): boolean {
  return typeof navigator !== "undefined" && !/jsdom/i.test(navigator.userAgent);
}

export async function captureA2uiVisualPngs(
  host: HTMLElement | null,
): Promise<Record<string, string>> {
  if (!host) return {};
  const out: Record<string, string> = {};
  const nodes = host.querySelectorAll<HTMLElement>("[data-a2ui-id]");
  for (const node of nodes) {
    const id = node.getAttribute("data-a2ui-id");
    if (!id) continue;
    const svg = node.querySelector("svg");
    if (!svg || svg.tagName.toLowerCase() !== "svg") continue;
    const el = svg as unknown as SVGSVGElement;
    const raster = shouldRasterizeSvgToPng() ? await svgToPngDataUrl(el) : undefined;
    out[id] = raster ?? svgToVisualDataUrl(el);
  }
  return out;
}

function writeClipboardViaCopyEvent(plain: string, html: string): boolean {
  const holder = document.createElement("div");
  holder.contentEditable = "true";
  holder.innerHTML = html;
  holder.setAttribute("aria-hidden", "true");
  Object.assign(holder.style, {
    position: "fixed",
    left: "-9999px",
    top: "0",
    width: "1px",
    height: "1px",
    overflow: "hidden",
  });
  document.body.appendChild(holder);

  let written = false;
  const onCopy = (event: ClipboardEvent) => {
    event.preventDefault();
    event.clipboardData?.setData("text/plain", plain);
    event.clipboardData?.setData("text/html", html);
    written = Boolean(event.clipboardData);
  };
  document.addEventListener("copy", onCopy, true);
  try {
    try {
      const range = document.createRange();
      range.selectNodeContents(holder);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      holder.focus();
    } catch {
      // Chromium still copies if execCommand('copy') runs while our listener is attached.
    }
    const ok = document.execCommand("copy");
    window.getSelection()?.removeAllRanges();
    return written || ok;
  } catch {
    return written;
  } finally {
    document.removeEventListener("copy", onCopy, true);
    holder.remove();
  }
}

export async function copyDualFormatToClipboard(plain: string, html: string): Promise<boolean> {
  // Prefer the copy-event path. Electron's ClipboardItem.write often accepts
  // the call but only keeps text/plain, so charts disappear on paste.
  if (html && writeClipboardViaCopyEvent(plain, html)) return true;
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([plain], { type: "text/plain" }),
          "text/html": new Blob([html], { type: "text/html" }),
        }),
      ]);
      return true;
    }
  } catch {
    // continue
  }
  try {
    await navigator.clipboard.writeText(plain);
    return true;
  } catch {
    return false;
  }
}
