import type { ToolDefinition } from "@flintloom/tools";
import { A2UI_CATALOG_ID, type A2uiService } from "./types.ts";

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
      const messages =
        typeof args.syntax === "string"
          ? wrapInfographicSyntax(args.syntax)
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
