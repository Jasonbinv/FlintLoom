import { recoverInfographicSyntax } from "./recover.ts";
import { parseAntvSyntax, resolveChatTemplate } from "./syntax.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanLabel(text: string): string {
  return text
    .replace(/['"`]*\}\s*\],\s*template:.*$/i, "")
    .replace(/<\|[^|>]*\|>/g, "")
    .trim();
}

function itemLabel(item: unknown, fallback: string): string {
  if (typeof item === "string" && item.trim()) return cleanLabel(item);
  if (isRecord(item) && typeof item.label === "string" && item.label.trim()) {
    return cleanLabel(item.label);
  }
  return fallback;
}

function itemChildren(item: unknown): unknown[] {
  return isRecord(item) && Array.isArray(item.children) ? item.children : [];
}

function hasGrandchildren(item: unknown): boolean {
  return itemChildren(item).some((child) => itemChildren(child).length > 0);
}

function inferTitle(args: Record<string, unknown>): unknown {
  if (typeof args.title === "string" && args.title.trim()) return args.title.trim();
  for (const [key, value] of Object.entries(args)) {
    if (/title/i.test(key) && typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function inferTemplate(args: Record<string, unknown>): string {
  if (typeof args.template === "string" && args.template.trim()) return args.template;
  const title = typeof inferTitle(args) === "string" ? String(inferTitle(args)) : "";
  if (/思维导图|mind\s*-?map/i.test(title)) return "mindmap";
  if (Array.isArray(args.items) && args.items.some(hasGrandchildren)) return "mindmap";
  return "steps";
}

function emitTreeItem(item: unknown, index: number, indent: string): string[] {
  const label = itemLabel(item, `分支${index + 1}`);
  const lines = [`${indent}- label ${label}`];
  const kids = itemChildren(item);
  const rec = isRecord(item) ? item : undefined;
  if (kids.length > 0) {
    lines.push(`${indent}  children`);
    for (const [kidIndex, kid] of kids.entries()) {
      lines.push(...emitTreeItem(kid, kidIndex, `${indent}    `));
    }
  } else if (rec && typeof rec.desc === "string" && rec.desc.trim()) {
    lines.push(`${indent}  desc ${rec.desc.trim()}`);
  }
  return lines;
}

function emitHierarchy(template: string, items: unknown[], title: unknown): string {
  const heading =
    (typeof title === "string" && title.trim() && cleanLabel(title)) ||
    (items.length === 1 ? itemLabel(items[0], "") : "") ||
    "中心主题";
  const roots = items.length === 1 && itemLabel(items[0], "") === heading ? itemChildren(items[0]) : items;
  const lines = [`infographic ${template}`, "data", "  root", `    label ${heading}`, "    children"];
  for (const [index, item] of roots.entries()) {
    lines.push(...emitTreeItem(item, index, "      "));
  }
  return lines.join("\n");
}

function payloadFromItems(
  template: string,
  items: unknown[],
  title: unknown,
): Record<string, unknown> {
  const heading = typeof title === "string" && title.trim() ? title.trim() : undefined;
  if (template.startsWith("compare-")) {
    return heading ? { template, title: heading, compares: items } : { template, compares: items };
  }
  if (template.startsWith("sequence-")) {
    return heading ? { template, title: heading, sequences: items } : { template, sequences: items };
  }
  if (template.startsWith("hierarchy-")) {
    return {
      template,
      root: { label: heading ?? "中心主题", children: items },
    };
  }
  return heading ? { template, title: heading, lists: items } : { template, lists: items };
}

export function compileInfographic(args: Record<string, unknown>): string {
  if (typeof args.syntax === "string" && args.syntax.trim()) {
    const recovered = recoverInfographicSyntax(args.syntax);
    return parseAntvSyntax(recovered ?? args.syntax);
  }
  const title = inferTitle(args);
  if (Array.isArray(args.items) && args.items.length > 0) {
    const template = resolveChatTemplate(inferTemplate(args));
    if (template.startsWith("hierarchy-")) {
      return parseAntvSyntax(emitHierarchy(template, args.items, title));
    }
    const mapped = payloadFromItems(template, args.items, title);
    const dsl = recoverInfographicSyntax(mapped);
    if (!dsl) {
      throw new Error("bad items");
    }
    return parseAntvSyntax(dsl);
  }
  const loose = recoverInfographicSyntax(args) ?? recoverInfographicSyntax(args.messages);
  if (loose) return parseAntvSyntax(loose);
  throw new Error("missing items");
}

export function infographicChatSurface(syntax: string): unknown[] {
  return [
    {
      version: "v0.9",
      createSurface: { surfaceId: "main", catalogId: "flintloom:a2ui:core" },
    },
    {
      version: "v0.9",
      updateComponents: {
        surfaceId: "main",
        components: [{ id: "root", component: "Infographic", syntax }],
      },
    },
  ];
}
