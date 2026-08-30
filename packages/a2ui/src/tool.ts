import type { ToolDefinition } from "@flintloom/tools";
import { A2UI_CATALOG_ID, type A2uiService } from "./types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstLineItem(text: string): { label: string; desc?: string } {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[•\-*]\s*/, "").trim())
    .filter((line) => line.length > 0);
  const label = lines[0] ?? "象限";
  const rest = lines.slice(1);
  return rest.length > 0 ? { label, desc: rest.join("、") } : { label };
}

function compareItemsFromUnknown(compares: unknown[]): { label: string; desc?: string }[] {
  return compares.slice(0, 8).map((item, index) => {
    if (typeof item === "string") return firstLineItem(item);
    if (!isRecord(item)) return { label: `象限${index + 1}` };
    const label = typeof item.label === "string" ? item.label.trim() : "";
    const desc = typeof item.desc === "string" ? item.desc.trim() : "";
    if (label && desc) return { label, desc: desc.replace(/\s+/g, " ") };
    if (label) return { label };
    if (desc) return firstLineItem(desc);
    return { label: `象限${index + 1}` };
  });
}

function syntaxFromCompareItems(items: { label: string; desc?: string }[]): string {
  const swot = items.some((item) => /优势|劣势|机遇|机会|威胁|strength|weakness|opportunit|threat/i.test(item.label));
  const template = swot
    ? "compare-swot"
    : items.length === 2
      ? "compare-binary-horizontal-simple-vs"
      : "compare-quadrant-quarter-simple-card";
  const lines = [`infographic ${template}`, "data", "  compares"];
  for (const item of items) {
    lines.push(`    - label ${item.label}`);
    if (template === "compare-swot") {
      const kids = (item.desc ?? "")
        .split(/[、,;；。\n]/)
        .map((part) => part.replace(/^[•\-*]\s*/, "").trim())
        .filter((part) => part.length > 0)
        .slice(0, 8);
      if (kids.length > 0) {
        lines.push("      children");
        for (const kid of kids) lines.push(`        - label ${kid}`);
      }
    } else if (item.desc) {
      lines.push(`      desc ${item.desc.replace(/\s+/g, " ")}`);
    }
  }
  return lines.join("\n");
}

function syntaxFromLooseMessages(messages: unknown): string | undefined {
  if (!Array.isArray(messages)) return undefined;
  for (const msg of messages) {
    if (!isRecord(msg)) continue;
    const model = isRecord(msg.updateDataModel) ? msg.updateDataModel : undefined;
    if (!model || !Array.isArray(model.compares) || model.compares.length < 2) continue;
    const items = compareItemsFromUnknown(model.compares);
    if (items.length < 2) continue;
    return syntaxFromCompareItems(items);
  }
  return undefined;
}

function wrapInfographicSyntax(syntax: string) {
  return [
    {
      version: "v0.9",
      createSurface: { surfaceId: "main", catalogId: A2UI_CATALOG_ID },
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

export function createA2uiEmitTool(svc: A2uiService): ToolDefinition {
  return {
    name: "a2ui_emit",
    description:
      "Emit A2UI UI. For an AntV infographic, pass ONLY syntax (first line infographic <template>), no messages and no HTML. Pick a family then a real template: list-* / sequence-* → lists|sequences; compare-binary-* (two sides) → compares; compare-swot (优势/劣势/机遇/威胁 only, points in children not desc); 四象限/quadrant → compare-quadrant-quarter-simple-card or compare-quadrant-quarter-circular (2x2 or center circle, never compare-swot); hierarchy-mindmap-* (思维导图, never stepList) or hierarchy-tree-* → root+children; relation-* → nodes+relations; chart-* / chart-wordcloud → values. Defaults: list-column-simple-vertical-arrow, list-row-simple-horizontal-arrow, compare-binary-horizontal-simple-vs, compare-swot, compare-quadrant-quarter-simple-card, hierarchy-mindmap-branch-gradient-capsule-item, relation-dagre-flow-tb-simple-circle-node, chart-line-plain-text. Official list-/sequence-/compare-/hierarchy-/relation-/chart- names pass through; aliases stepList/timeline/compare/cards/mindmap/tree/quadrant/四象限 are repaired. Body uses data and key value (not label:). No http(s). For cards/tables/A2UI Chart components, pass messages[]: each item must be version v0.9 (not 0.9) and exactly one of createSurface, updateComponents, updateDataModel, or deleteSurface. Never put type/kind on the envelope.",
    parameters: {
      type: "object",
      properties: {
        syntax: {
          type: "string",
          description:
            "AntV infographic DSL. First line: infographic <template>. One data field: lists|sequences|compares|root|nodes|values. Space-separated keys, not YAML label:. SWOT points go in children, not root desc. 四象限 uses compare-quadrant-* (label+desc), never compare-swot. Relation / chart need official nested DSL. Use mindmap for 思维导图, not stepList.",
        },
        messages: {
          type: "array",
          description: "A2UI v0.9 message envelopes for a single surface.",
        },
      },
    },
    async execute(args, exec) {
      if (exec.signal.aborted) {
        return "aborted";
      }
      const recovered =
        typeof args.syntax !== "string" ? syntaxFromLooseMessages(args.messages) : undefined;
      const messages =
        typeof args.syntax === "string"
          ? wrapInfographicSyntax(args.syntax)
          : recovered
            ? wrapInfographicSyntax(recovered)
            : args.messages;
      if (messages === undefined) {
        return "failed: missing messages";
      }
      try {
        const snap = svc.validateEmit(messages);
        return JSON.stringify({
          status: "ok",
          surfaceId: snap.surfaceId,
          wait: snap.wait,
          emitId: snap.emitId,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `failed: ${message}`;
      }
    },
  };
}
