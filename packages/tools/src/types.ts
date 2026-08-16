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
