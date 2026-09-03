import type { ToolDefinition } from "@flintloom/tools";
import { type A2uiService } from "./types.ts";

export function createA2uiEmitTool(svc: A2uiService): ToolDefinition {
  return {
    name: "a2ui_emit",
    description:
      'Emit interactive A2UI v0.9 in chat: buttons, pickers, tables, and Chart. Pass messages[] in one call: createSurface then updateComponents. catalogId is flintloom:a2ui:core. One component id must be "root". Example: [{"version":"v0.9","createSurface":{"surfaceId":"main","catalogId":"flintloom:a2ui:core"}},{"version":"v0.9","updateComponents":{"surfaceId":"main","components":[{"id":"root","component":"Chart","kind":"bar","labels":["A"],"values":[1]}]}}]. If emit fails, fix this JSON and retry.',
    parameters: {
      type: "object",
      properties: {
        messages: {
          type: "array",
          description:
            'A2UI v0.9 envelopes for one surface. Include createSurface and updateComponents together. Root component id is "root".',
        },
      },
    },
    async execute(args, exec) {
      if (exec.signal.aborted) {
        return "aborted";
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
