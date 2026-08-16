export const TOOLS_PRE_EXECUTE = "tools/pre-execute";

export type ToolPreExecutePayload = {
  tool: string;
  args: Record<string, unknown>;
  workspaceRoot: string;
  channel: string;
  signal: AbortSignal;
};

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>, exec: ToolExec): Promise<string>;
}

export interface ToolExec {
  workspaceRoot: string;
  signal: AbortSignal;
  channel: string;
}
