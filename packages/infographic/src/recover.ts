function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function flattenIgValue(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function firstLineItem(text: string): { label: string; desc?: string } {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[•\-*]\s*/, "").trim())
    .filter((line) => line.length > 0);
  const label = lines[0] ?? "项目";
  const rest = lines.slice(1);
  return rest.length > 0 ? { label, desc: rest.join("、") } : { label };
}

function childLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const labels: string[] = [];
  for (const child of value) {
    if (typeof child === "string" && child.trim()) {
      labels.push(flattenIgValue(child));
      continue;
    }
    if (!isRecord(child)) continue;
    for (const key of ["label", "desc", "title", "name"]) {
      const text = child[key];
      if (typeof text === "string" && text.trim()) {
        labels.push(flattenIgValue(text));
        break;
      }
    }
  }
  return labels.slice(0, 8);
}

type LooseItem = { label: string; desc?: string; kids: string[] };

function itemFromUnknown(item: unknown, fallback: string): LooseItem {
  if (typeof item === "string") {
    const parsed = firstLineItem(item);
    return { label: parsed.label, desc: parsed.desc, kids: [] };
  }
  if (!isRecord(item)) return { label: fallback, kids: [] };
  const labelRaw =
    (typeof item.label === "string" && item.label.trim()) ||
    (typeof item.title === "string" && item.title.trim()) ||
    (typeof item.name === "string" && item.name.trim()) ||
    "";
  const desc = typeof item.desc === "string" ? item.desc.trim() : "";
  const kids = childLabels(item.children);
  if (labelRaw) {
    return {
      label: flattenIgValue(labelRaw),
      desc: desc ? flattenIgValue(desc) : undefined,
      kids,
    };
  }
  if (desc) {
    const parsed = firstLineItem(desc);
    return { label: parsed.label, desc: parsed.desc, kids };
  }
  return { label: fallback, kids };
}

function itemsFromUnknown(values: unknown[]): LooseItem[] {
  const items = values.slice(0, 12).map((item, index) => itemFromUnknown(item, `项目${index + 1}`));
  if (
    items.length === 1 &&
    /^项目\d+$/.test(items[0]!.label) &&
    isRecord(values[0]) &&
    Array.isArray(values[0].children) &&
    values[0].children.length >= 2
  ) {
    return itemsFromUnknown(values[0].children);
  }
  return items;
}

function splitDescKids(desc: string | undefined): string[] {
  if (!desc) return [];
  return desc
    .split(/[、,;；。\n]/)
    .map((part) => part.replace(/^[•\-*]\s*/, "").trim())
    .filter((part) => part.length > 0)
    .slice(0, 8);
}

function emitFieldBlock(
  template: string,
  field: "lists" | "compares" | "sequences",
  items: LooseItem[],
  asSwot: boolean,
): string {
  const lines = [`infographic ${template}`, "data", `  ${field}`];
  for (const item of items) {
    lines.push(`    - label ${item.label}`);
    const kids = item.kids.length > 0 ? item.kids : asSwot ? splitDescKids(item.desc) : [];
    if (kids.length > 0) {
      lines.push("      children");
      for (const kid of kids) lines.push(`        - label ${kid}`);
    } else if (item.desc) {
      lines.push(`      desc ${item.desc}`);
    }
  }
  return lines.join("\n");
}

function syntaxFromCompares(items: LooseItem[]): string {
  const swot = items.some((item) =>
    /优势|劣势|机遇|机会|威胁|strength|weakness|opportunit|threat/i.test(item.label),
  );
  const template = swot
    ? "compare-swot"
    : items.length === 2
      ? "compare-binary-horizontal-simple-vs"
      : "compare-quadrant-quarter-simple-card";
  return emitFieldBlock(template, "compares", items, swot);
}

function collectBuckets(
  value: unknown,
  acc: { compares?: unknown[]; lists?: unknown[]; sequences?: unknown[] },
  depth: number,
): void {
  if (depth > 10 || value == null) return;
  if (Array.isArray(value)) {
    for (const item of value) collectBuckets(item, acc, depth + 1);
    return;
  }
  if (!isRecord(value)) return;
  if (!acc.compares && Array.isArray(value.compares) && value.compares.length >= 2) {
    acc.compares = value.compares;
  }
  if (!acc.lists && Array.isArray(value.lists) && value.lists.length >= 1) {
    acc.lists = value.lists;
  }
  if (!acc.lists && Array.isArray(value.items) && value.items.length >= 1) {
    acc.lists = value.items;
  }
  if (!acc.sequences && Array.isArray(value.sequences) && value.sequences.length >= 1) {
    acc.sequences = value.sequences;
  }
  for (const nested of Object.values(value)) collectBuckets(nested, acc, depth + 1);
}

export function recoverInfographicSyntax(raw: unknown): string | undefined {
  let payload: unknown = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (/^infographic\b/i.test(trimmed)) return trimmed;
    try {
      payload = JSON.parse(trimmed) as unknown;
    } catch {
      return undefined;
    }
  }
  const templateHint =
    isRecord(payload) && typeof payload.template === "string" ? payload.template.trim() : "";
  const acc: { compares?: unknown[]; lists?: unknown[]; sequences?: unknown[] } = {};
  collectBuckets(payload, acc, 0);
  if (acc.compares && acc.compares.length >= 2) {
    const items = itemsFromUnknown(acc.compares);
    if (templateHint.startsWith("compare-")) {
      return emitFieldBlock(templateHint, "compares", items, templateHint.startsWith("compare-swot"));
    }
    return syntaxFromCompares(items);
  }
  if (acc.sequences && acc.sequences.length >= 1) {
    const template = templateHint.startsWith("sequence-") ? templateHint : "sequence-steps-simple";
    return emitFieldBlock(template, "sequences", itemsFromUnknown(acc.sequences), false);
  }
  if (acc.lists && acc.lists.length >= 1) {
    const template = templateHint.startsWith("list-") ? templateHint : "list-column-simple-vertical-arrow";
    return emitFieldBlock(template, "lists", itemsFromUnknown(acc.lists), false);
  }
  return undefined;
}
