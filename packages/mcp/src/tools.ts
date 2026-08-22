import type { ToolDefinition, ToolRegistry } from "@flintloom/tools";
import type { McpStdioClient } from "./client.ts";

const MCP_TOOL_NAME_RE = /^[a-zA-Z0-9_-]+$/;

export function registerMcpTools(input: {
  tools: ToolRegistry;
  id: string;
  client: McpStdioClient;
}): () => void {
  const disposers: (() => void)[] = [];
  for (const tool of input.client.listTools()) {
    if (!MCP_TOOL_NAME_RE.test(tool.name)) {
      continue;
    }
    const registeredName = `mcp__${input.id}__${tool.name}`;
    const def: ToolDefinition = {
      name: registeredName,
      description: tool.description ?? `MCP tool ${tool.name}`,
      parameters:
        tool.inputSchema ?? { type: "object", properties: {} },
      async execute(args, exec) {
        if (exec.signal.aborted) {
          return "aborted";
        }
        try {
          return await input.client.callTool(tool.name, args, exec.signal);
        } catch (err) {
          if (exec.signal.aborted) {
            return "aborted";
          }
          return "failed: mcp";
        }
      },
    };
    disposers.push(input.tools.register(def));
  }
  return () => {
    for (const dispose of disposers.reverse()) {
      dispose();
    }
  };
}
