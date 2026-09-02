import type { ToolDefinition } from "@flintloom/tools";
import { type A2uiService } from "./types.ts";

export function createA2uiEmitTool(svc: A2uiService): ToolDefinition {
  return {
    name: "a2ui_emit",
    description:
      "Emit interactive A2UI in chat: buttons, choice pickers, tables, and A2UI Chart. Pass messages[]: each item must be version v0.9 and exactly one of createSurface, updateComponents, updateDataModel, or deleteSurface. Never put type/kind on the envelope. For SWOT, steps, mind maps, and other AntV infographics, call infographic_render instead.",
    parameters: {
      type: "object",
      properties: {
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
      if (typeof args.syntax === "string") {
        return "failed: use infographic_render";
      }
      const messages = args.messages;
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
