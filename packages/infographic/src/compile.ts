import { recoverInfographicSyntax } from "./recover.ts";
import { parseAntvSyntax, resolveChatTemplate } from "./syntax.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function emitHierarchy(template: string, items: unknown[], title: unknown): string {
  const heading = typeof title === "string" && title.trim() ? title.trim() : "中心主题";
  const lines = [`infographic ${template}`, "data", "  root", `    label ${heading}`, "    children"];
  for (const [index, item] of items.entries()) {
    const rec = isRecord(item) ? item : undefined;
    const label =
      (rec && typeof rec.label === "string" && rec.label.trim()) ||
      (typeof item === "string" ? item.trim() : "") ||
      `分支${index + 1}`;
    lines.push(`      - label ${label}`);
    const kids = rec && Array.isArray(rec.children) ? rec.children : [];
    if (kids.length > 0) {
      lines.push("        children");
      for (const kid of kids) {
        const kidRec = isRecord(kid) ? kid : undefined;
        const kidLabel =
          (kidRec && typeof kidRec.label === "string" && kidRec.label.trim()) ||
          (typeof kid === "string" ? kid.trim() : "");
        if (kidLabel) lines.push(`          - label ${kidLabel}`);
      }
    } else if (rec && typeof rec.desc === "string" && rec.desc.trim()) {
      lines.push(`        desc ${rec.desc.trim()}`);
    }
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
  const templateRaw = typeof args.template === "string" ? args.template : "";
  if (Array.isArray(args.items) && args.items.length > 0) {
    const template = resolveChatTemplate(templateRaw || "steps");
    if (template.startsWith("hierarchy-")) {
      return parseAntvSyntax(emitHierarchy(template, args.items, args.title));
    }
    const mapped = payloadFromItems(template, args.items, args.title);
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
