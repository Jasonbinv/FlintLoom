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
      "Emit A2UI UI. For an AntV infographic, pass ONLY syntax (string starting with 'infographic <template>'), no messages. Preferred templates: list-column-simple-vertical-arrow, list-row-simple-horizontal-arrow, compare-binary-horizontal-simple-vs, list-grid-compact-card, sequence-steps-simple, hierarchy-mindmap-branch-gradient-capsule-item. Aliases stepList/timeline/compare/cards/mindmap are repaired. For a mind map / 思维导图, use mindmap — never stepList (that is a flowchart). SWOT and relation networks are not auto-drawn from prose. For cards/tables/charts, pass messages[]: each item must be version v0.9 (not 0.9) and exactly one of createSurface, updateComponents, updateDataModel, or deleteSurface. Never put type/kind on the envelope. Infographic syntax must not include http:// or https://.",
    parameters: {
      type: "object",
      properties: {
        syntax: {
          type: "string",
          description:
            "AntV infographic DSL. First line: infographic <template>. Official body uses data / lists|compares|root / - label / desc / children (space, not label:). Invented headings, bullets, and YAML root/label:/children: are repaired. Use mindmap for 思维导图, not stepList.",
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
