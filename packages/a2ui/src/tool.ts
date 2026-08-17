import type { ToolDefinition } from "@flintloom/tools";
import type { A2uiService } from "./types.ts";

export function createA2uiEmitTool(svc: A2uiService): ToolDefinition {
  return {
    name: "a2ui_emit",
    description: "Emit A2UI messages to render an interactive surface.",
    parameters: {
      type: "object",
      properties: {
        messages: {
          type: "array",
          description: "A2UI v0.9 message envelopes for a single surface.",
        },
      },
      required: ["messages"],
    },
    async execute(args, exec) {
      if (exec.signal.aborted) {
        return "aborted";
      }
      if (!("messages" in args)) {
        return "failed: missing messages";
      }
      try {
        const snap = svc.validateEmit(args.messages);
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
